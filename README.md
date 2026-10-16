# ShopMind

Multimodal product retrieval (A1) and multi-source RAG answers (A3) over an Amazon Berkeley Objects subset.

| Folder | Contents |
| --- | --- |
| [`api/`](api/README.md) | FastAPI backend, Elasticsearch indexing, SigLIP2 embeddings, evaluation |
| [`ui/`](ui/README.md) | React + Vite storefront and retrieval lab |

## Run the full stack

```bash
cp .env.example .env    # then fill in OPENAI_API_KEY etc.
docker compose up -d --build
```

Open <http://localhost:5173>. The API is on <http://localhost:8000>.

Dataset preparation, indexing, and evaluation steps are in [`api/README.md`](api/README.md). Frontend development and mock mode are in [`ui/README.md`](ui/README.md).
