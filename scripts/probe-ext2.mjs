const VIDEO_EXTENSIONS = ["mp4","webm","ogv","ogg","mov"];
const IMAGE_EXTENSIONS = ["jpg","jpeg","png","webp","avif","gif","svg"];
function lastExtension(s){ const seg=s.split("/").filter(Boolean).pop()||""; const m=/\.([a-z0-9]{2,5})$/.exec(seg); return m?m[1]:""; }
function extensionHint(url){
  const clean=url.split("#")[0].toLowerCase();
  const qi=clean.indexOf("?");
  const query=qi===-1?"":clean.slice(qi+1);
  let path=qi===-1?clean:clean.slice(0,qi);
  if(/^[a-z][a-z0-9+.-]*:\/\//.test(path)){
    try{ path=new URL(path).pathname; }catch{ path=path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/,""); }
  }
  const fp=lastExtension(path);
  return fp||lastExtension(query);
}
const cases = [
  ['https://llzqkduccdbbetevpoql.supabase.co/storage/v1/object/public/catalogue-images/greeting/probe-1.png','png'],
  ['https://llzqkduccdbbetevpoql.supabase.co/storage/v1/object/public/catalogue-images/welcome/clip.mp4','mp4'],
  ['https://cdn.example.com/movies/promo.mp4','mp4'],
  ['https://cdn.example.com/d?file=promo.mp4','mp4'],
  ['https://evil.example.com/page.html?x=.mp4','html'],
  ['https://terabox.com/s/abc',''],
  ['https://godoor.site/brand/welcome.jpg','jpg'],
  ['https://cdn.example.com/i/8f3a91',''],
  ['/brand/welcome.gif','gif'],
  ['https://llzqkduccdbbetevpoql.supabase.co/storage/v1/object/public/catalogue-images/welcome/clip.webm','webm'],
  ['https://x.supabase.co/storage/v1/object/public/b/a/archive.tar.gz','gz'],
];
let fail=0;
for (const [u,exp] of cases) {
  const e=extensionHint(u);
  const ok = e===exp;
  if(!ok) fail++;
  console.log(`${ok?'PASS':'FAIL'} ext=${(e||'(none)').padEnd(6)} expected=${(exp||'(none)').padEnd(6)} video=${VIDEO_EXTENSIONS.includes(e)} image=${IMAGE_EXTENSIONS.includes(e)}  ${u}`);
}
console.log(fail? `\n${fail} FAILURES` : '\nAll extension cases PASS');
