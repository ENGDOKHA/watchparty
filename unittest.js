// Unit tests for the cinemana resolver, subtitle conversion, quality pick, and id parsing.
const assert = require('assert');
const { srtToVtt, pickBest, resolveCinemana, extractStreams } = require('./server.js');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓', name); pass++; };

// 1) SRT -> VTT
const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:04,000\nHello world\n');
ok('VTT header added', vtt.startsWith('WEBVTT'));
ok('comma timestamps -> dots', vtt.includes('00:00:01.000 --> 00:00:04.000'));
ok('text preserved', vtt.includes('Hello world'));

// 2) pickBest chooses highest resolution and requires videoUrl
const best = pickBest([
  { name: 'mp4-480', resolution: '480p', videoUrl: 'a' },
  { name: 'mp4-1080', resolution: '1080p', videoUrl: 'b' },
  { name: 'mp4-720', resolution: '720p', videoUrl: 'c' },
  { name: 'mp4-2160', resolution: '2160p' }, // no url -> ignored
]);
ok('pickBest picks 1080p (highest with url)', best && best.videoUrl === 'b');
ok('pickBest returns null on empty', pickBest([]) === null);

// 3) parseCinemanaId (mirror of the client logic)
function parseCinemanaId(input){
  const s=(input||'').trim();
  if(/^\d+$/.test(s)) return s;
  if(/cinemana\.shabakaty\.com/i.test(s)){ const n=s.match(/\d{3,}/g); if(n) return n.sort((a,b)=>b.length-a.length)[0]; }
  return null;
}
ok('raw id', parseCinemanaId('25006') === '25006');
ok('url with id', parseCinemanaId('https://cinemana.shabakaty.com/video/25006/some-title') === '25006');
ok('non-cinemana url -> null', parseCinemanaId('https://example.com/x') === null);

// 4) resolveCinemana with a mocked fetch (no real network)
const savedFetch = global.fetch;
global.fetch = async (url) => {
  const body =
    url.includes('allVideoInfo')     ? { en_title: 'The Matrix', kind: '1' } :
    url.includes('transcoddedFiles') ? [ { name:'mp4-480', resolution:'480p', videoUrl:'http://v/480.mp4' },
                                         { name:'mp4-1080', resolution:'1080p', videoUrl:'http://v/1080.mp4' } ] :
    url.includes('translationFiles') ? { translations: [
                                         { name:'ar', file:'http://s/ar.srt' },
                                         { name:'en', file:'http://s/en.vtt' },
                                         { name:'x',  file:'http://s/defaultImages/loading.gif' } ] } : {};
  return { ok:true, status:200, json: async () => body, text: async () => '' };
};

(async () => {
  const r = await resolveCinemana('25006');
  ok('resolve title', r.title === 'The Matrix');
  ok('resolve best videoUrl = 1080', r.videoUrl === 'http://v/1080.mp4');
  ok('resolve drops loading.gif sub', r.subtitles.length === 2);
  ok('resolve keeps ar + en', r.subtitles.map(s=>s.lang).sort().join(',') === 'ar,en');
  global.fetch = savedFetch;

  // ---------- 5) sync logic: the anti-oscillation rules ----------
  const S = require('./public/sync-logic.js');

  ok('tiny drift is ignored (no fiddling)', S.decide(0.2, 10000, 0).action === 'none');
  ok('tiny drift keeps rate 1', S.decide(0.2, 10000, 0).rate === 1);

  const softAhead = S.decide(1.0, 10000, 0);
  ok('medium drift eases, never jumps', softAhead.action === 'soft');
  ok('ahead -> slow down', softAhead.rate < 1);
  ok('behind -> speed up', S.decide(-1.0, 10000, 0).rate > 1);

  ok('big drift jumps once', S.decide(10, 10000, 0).action === 'hard');
  // The cooldown is the key ping-pong guard: a second big correction right away must NOT jump.
  ok('no second jump within cooldown', S.decide(10, 10000, 9000).action === 'soft');
  ok('jump allowed after cooldown', S.decide(10, 20000, 10000).action === 'hard');
  ok('NaN drift is safe', S.decide(NaN, 10000, 0).action === 'none');

  // offset mapping for two different sites' copies
  ok('local->movie subtracts offset', S.toMovieTime(65, 5) === 60);
  ok('movie->local adds offset', S.toLocalTime(60, 5) === 65);
  ok('offset round-trips', S.toLocalTime(S.toMovieTime(123.5, -7.5), -7.5) === 123.5);

  // stall recovery skips forward (continue with the group, don't resume from the freeze)
  ok('stall skip converts ms to s', Math.abs(S.stallSkip(4000) - 4) < 1e-9);
  ok('stall skip is capped', S.stallSkip(10 * 60 * 1000) === S.MAX_SKIP);
  ok('negative stall is 0', S.stallSkip(-5) === 0);

  // stale message rejection
  ok('newer seq accepted', S.isFresh(5, 4) === true);
  ok('older seq rejected', S.isFresh(3, 4) === false);
  ok('same seq rejected', S.isFresh(4, 4) === false);

  // ---------- 6) per-viewer quality choice ----------
  const QL = [
    { name:'mp4-480',  resolution:'480p',  videoUrl:'u480' },
    { name:'mp4-1080', resolution:'1080p', videoUrl:'u1080' },
    { name:'mp4-720',  resolution:'720p',  videoUrl:'u720' },
    { name:'mp4-2160', resolution:'2160p' },              // unplayable, no url
  ];
  ok('auto picks highest playable', S.chooseQuality(QL, '').videoUrl === 'u1080');
  ok('preference respected', S.chooseQuality(QL, 'mp4-480').videoUrl === 'u480');
  ok('unknown preference falls back to best', S.chooseQuality(QL, 'mp4-9999').videoUrl === 'u1080');
  ok('empty list -> null', S.chooseQuality([], 'mp4-480') === null);
  ok('unplayable entries excluded', S.sortedQualities(QL).every(q => !!q.videoUrl));
  ok('dropdown order is highest first', S.sortedQualities(QL).map(q=>q.resolution).join(',') === '1080p,720p,480p');
  // Two viewers, same list, different choices -> different streams (independent quality).
  ok('viewers get independent streams',
     S.chooseQuality(QL,'mp4-480').videoUrl !== S.chooseQuality(QL,'mp4-1080').videoUrl);

  // ---------- 7) subtitle re-timing (borrowed subs from another copy) ----------
  const cue = 'WEBVTT\n\n1\n00:00:10.000 --> 00:00:12.500\nHello\n';
  ok('no shift returns input unchanged', S.shiftVtt(cue, 0) === cue);
  ok('positive shift delays cues',
     S.shiftVtt(cue, 2).includes('00:00:12.000 --> 00:00:14.500'));
  ok('negative shift advances cues',
     S.shiftVtt(cue, -3).includes('00:00:07.000 --> 00:00:09.500'));
  ok('never goes below zero',
     S.shiftVtt(cue, -60).includes('00:00:00.000 --> 00:00:00.000'));
  ok('fractional shift works',
     S.shiftVtt(cue, 0.25).includes('00:00:10.250 --> 00:00:12.750'));
  ok('ms carry rolls into seconds',
     S.shiftVtt('00:00:10.800 --> 00:00:11.000', 0.5).startsWith('00:00:11.300'));
  ok('minute/hour carry works',
     S.shiftVtt('00:59:59.500 --> 01:00:00.000', 1).startsWith('01:00:00.500'));
  // SRT comma timestamps are accepted too
  ok('srt comma format shifts',
     S.shiftVtt('00:00:05,000 --> 00:00:06,000', 1).startsWith('00:00:06.000'));
  ok('subtitle text is untouched', S.shiftVtt(cue, 5).includes('Hello'));

  // ---------- 8) page -> stream extraction (albox-style pages) ----------
  const ALBOX = 'https://cinema.albox.co/show/play/1041177';
  const MP4 = 'https://cloud02.albox.co/episodes/4e453ac5-0c1a-4b37-8c6f-4184f24c6ddf.mp4';

  ok('finds a plain mp4 in a <source> tag',
     extractStreams(`<video><source src="${MP4}" type="video/mp4"></video>`, ALBOX)[0] === MP4);
  ok('finds an mp4 inside escaped JSON',
     extractStreams(`{"file":"https:\\/\\/cloud02.albox.co\\/episodes\\/4e453ac5-0c1a-4b37-8c6f-4184f24c6ddf.mp4"}`, ALBOX)[0] === MP4);
  ok('resolves a root-relative path against the page origin',
     extractStreams(`<source src="/episodes/abc.mp4">`, ALBOX)[0] === 'https://cinema.albox.co/episodes/abc.mp4');
  ok('resolves a protocol-relative url',
     extractStreams(`<source src="//cloud02.albox.co/episodes/x.mp4">`, ALBOX)[0] === 'https://cloud02.albox.co/episodes/x.mp4');
  ok('decodes &amp; in query strings',
     extractStreams(`<source src="https://h/v.mp4?a=1&amp;b=2">`, ALBOX)[0] === 'https://h/v.mp4?a=1&b=2');
  ok('prefers mp4 over m3u8',
     extractStreams(`"https://h/a.m3u8" "${MP4}"`, ALBOX)[0] === MP4);
  ok('still finds m3u8 when that is all there is',
     extractStreams(`"https://h/master.m3u8"`, ALBOX)[0] === 'https://h/master.m3u8');
  ok('de-duplicates repeats',
     extractStreams(`"${MP4}" "${MP4}"`, ALBOX).length === 1);
  ok('ignores pages with no media', extractStreams('<html><img src="a.png"></html>', ALBOX).length === 0);
  ok('empty html is safe', extractStreams('', ALBOX).length === 0);
  ok('null html is safe', extractStreams(null, ALBOX).length === 0);
  ok('bad base url does not throw', Array.isArray(extractStreams(`<source src="/a.mp4">`, 'not a url')));

  console.log(`\nUNIT: ${pass} checks passed ✅`);
})().catch(e => { console.error('UNIT FAIL ❌', e); process.exit(1); });
