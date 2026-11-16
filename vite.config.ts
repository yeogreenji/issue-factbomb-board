import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 프로젝트 사이트(https://yeogreenji.github.io/issue-factbomb-board/)에서도 열리도록
// Actions 빌드에서만 하위 경로를 base로 잡고, 로컬 dev는 그대로 '/'를 씁니다.
// 서버리스 함수를 로컬에서 같이 보고 싶으면 `API_PROXY_TARGET=http://127.0.0.1:5186 npm run dev`.
const apiProxyTarget = process.env.API_PROXY_TARGET;

// GitHub Pages(또는 VITE_STATIC_ONLY=1) 빌드는 /api/* 가 없는 정적 사이트이므로,
// 앱이 서버를 탐색하지 않고 처음부터 '로컬 체험 모드'로 뜨게 합니다.
const staticOnly = Boolean(process.env.GITHUB_ACTIONS || process.env.VITE_STATIC_ONLY);

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/issue-factbomb-board/' : '/',
  plugins: [react(), tailwindcss()],
  define: { __FACTBOMB_STATIC__: JSON.stringify(staticOnly) },
  server: {
    port: 5185,
    host: true,
    proxy: apiProxyTarget ? { '/api': { target: apiProxyTarget, changeOrigin: true } } : undefined,
  },
  preview: { port: 4185, host: true },
});
