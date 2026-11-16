/**
 * 빌드 시점 상수.
 * `__FACTBOMB_STATIC__` 는 GitHub Pages처럼 서버리스 API가 없는 정적 호스팅 빌드에서 true가 되고,
 * 그때는 /api/* 탐색 요청 자체를 보내지 않습니다(불필요한 404·콘솔 오류 방지).
 */
declare const __FACTBOMB_STATIC__: boolean;
