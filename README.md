# ShopMind A1 UI

React + Vite interface for comparing ShopMind retrieval modes and searching the product index with an image.

## Run with the backend

From `/Users/yuji/research/rag/test`:

```bash
docker compose up --build
```

Open <http://localhost:5173>.

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
