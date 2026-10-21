const VIDEO_EXTENSIONS = ["mp4","webm","ogv","ogg","mov"];
const IMAGE_EXTENSIONS = ["jpg","jpeg","png","webp","avif","gif","svg"];
function lastExtension(s){ const m=/\.([a-z0-9]{2,5})(?=$|[?&#/])/.exec(s); return m?m[1]:""; }
function extensionHint(url){
  const clean=url.split("#")[0].toLowerCase();
  const qi=clean.indexOf("?");
  const path=qi===-1?clean:clean.slice(0,qi);
  const query=qi===-1?"":clean.slice(qi+1);
  const fromPath=lastExtension(path);
  if(fromPath) return fromPath;
  return lastExtension(query);
}
const urls = [
  'https://llzqkduccdbbetevpoql.supabase.co/storage/v1/object/public/catalogue-images/greeting/probe-1792595580343.png',
  'https://llzqkduccdbbetevpoql.supabase.co/storage/v1/object/public/catalogue-images/welcome/clip.mp4',
  'https://cdn.example.com/movies/promo.mp4',
  'https://cdn.example.com/i/8f3a91',
  'https://terabox.com/s/abc',
  'https://godoor.site/brand/welcome.jpg',
];
for (const u of urls) {
  const e = extensionHint(u);
  console.log(`ext=${(e||'(none)').padEnd(6)} video=${VIDEO_EXTENSIONS.includes(e)} image=${IMAGE_EXTENSIONS.includes(e)}  ${u}`);
}
