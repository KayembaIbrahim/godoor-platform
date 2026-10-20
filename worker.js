export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, 'https://godoor-platform-hjmuw6jrw-ibrahimkapoor11-gmailcoms-projects.vercel.app');

    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    return await fetch(proxyRequest);
  }
};