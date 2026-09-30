# ShopMind A1 + A3 UI

React + Vite interface for comparing retrieval modes, searching by image, and asking source-backed questions about a selected product.

## Run with the backend

From `/Users/yuji/research/rag/test`:

```bash
docker compose up --build
```

Open <http://localhost:5173>.

Search by text or image, choose **Ask about this product** on a result, then enter a question. Questions use product details by default; enable reviews or experimental policies after those indexes are loaded. Further questions stay scoped to that product until you choose another result. Each answer shows its cited sources and retrieval scores; curated ShopMind policy sources are marked experimental. The backend needs `OPENAI_API_KEY` for generated answers.

## Frontend development

Start the FastAPI backend on port 8000, then run:

```bash
npm install
npm run dev
```

Set `VITE_API_PROXY_TARGET` to use a backend other than `http://localhost:8000`.

## Checks

```bash
npm test
npm run build
```
