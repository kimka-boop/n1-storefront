# N°1 — 20 Pieces. Selected by AI.

구글 시트 기반 실시간 연동 쇼핑몰. FASHN AI 가상 피팅 lookbook 5샷 (전체샷/45도/90도/후면/제품누끼).

## 구조
- `app/` — Next.js 14 (App Router)
- `app/api/products` — 구글 시트 실시간 읽기
- `app/api/lookbook-files` — 드라이브 폴더 이미지 목록
- `public/` — 정적 자산

## 환경변수 (Vercel Settings → Environment Variables)
| 키 | 설명 |
|---|---|
| `N1_SHEET_ID` | 구글 시트 ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | 서비스계정 이메일 |
| `GOOGLE_PRIVATE_KEY` | 서비스계정 개인키 (`\n` 이스케이프 유지) |

## 실행
```bash
npm install
npm run dev
```
