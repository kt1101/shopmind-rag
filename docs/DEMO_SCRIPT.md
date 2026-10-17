# Kịch bản demo ShopMind (≈10 phút)

Mở rộng từ [REFACTOR_PLAN.md](REFACTOR_PLAN.md) §13 thành từng bước bấm cụ thể. Tên nút trong
ngoặc kép là nhãn dự kiến trên UI; nếu nhãn thực tế khác, giữ nguyên thứ tự thao tác.

## 0. Chuẩn bị (trước buổi demo, ~15 phút)

```bash
cp .env.example .env            # điền OPENAI_API_KEY, đổi ADMIN_PASSWORD
make setup
make up
make ps                         # api phải "healthy"
make index                      # nếu alias products chưa có
make index-policies             # chat cần alias policies
make seed                       # admin + dữ liệu demo (feedback, eval run mẫu)
curl -fsS http://localhost:8000/ready
curl -s http://localhost:9200/_cat/aliases?v
```

Kiểm tra trước:

- [ ] `/ready` trả `200`, các component `elasticsearch`, `embedder`, `text_embedder`, `database` là `ok`, `llm` là `ok`.
- [ ] Alias `products`, `policies` trỏ đúng index (`_cat/aliases`).
- [ ] Policy `returns.window` đang ghi **30 ngày** (`api/data/policies/shopmind_policies.jsonl`).
- [ ] Có sẵn một ảnh túi xách để tải lên (ví dụ chụp từ trang một sản phẩm túi trong catalog), lưu ở Desktop.
- [ ] Đã chạy ít nhất một run A1 (`make eval-a1`) để Evaluation Center có dữ liệu so sánh.
- [ ] Trình duyệt: cửa sổ 1 mở <http://localhost:5173>, cửa sổ 2 mở <http://localhost:5173/admin> (đã đăng nhập), zoom 110–125%.
- [ ] Phương án dự phòng không có mạng/API key: bỏ bước 4–5 phần sinh câu trả lời, vẫn demo được trace retrieval và s0–s3.

Ghi chú khi trình bày: giá, tồn kho và policy là dữ liệu **tổng hợp / thử nghiệm**; qrels là nhãn seed
chưa được người duyệt. Nói rõ điều này khi đưa số liệu.

## 1. Storefront + Search Inspector (2 phút)

Khách hàng không chọn thuật toán: ô tìm kiếm chạy pipeline admin đặt ở `defaults.search`. Các nút
"glass-box" chỉ hiện khi đã đăng nhập admin (header có nhãn **"Chế độ quản trị"**). Trước bước này,
đăng nhập <http://localhost:5173/admin> trong cùng trình duyệt để bật chế độ quản trị.

1. Ở trang chủ <http://localhost:5173>, bấm vào ô tìm kiếm ở header.
2. Gõ chậm `giày bốt` và dừng lại: chỉ vào **autocomplete** (gợi ý sản phẩm, category, brand).
3. Gõ hết `giày bốt da màu nâu`, nhấn **Enter**. Trang `/search` hiện kết quả; chỉ vào facet có đếm
   số lượng và chip bộ lọc.
4. Bấm nút **"Vì sao có kết quả này?"** để mở Search Inspector (drawer bên phải).
5. Tab **"Truy vấn"**: ngôn ngữ phát hiện `vi`, alias `giày bốt` → category `boot`, màu `nâu` → `brown`,
   chế độ (`hybrid` hoặc lựa chọn của `adaptive` kèm lý do), bộ lọc giải theo *exact catalog match*.
6. Tab **"Xếp hạng"**: bảng rank BM25 / dense / fused; chỉ vào biểu đồ **rank movement** và công thức
   RRF điền số thật, ví dụ `1/(60+1) + 1/(60+3)`.
7. Tab **"Từ khoá khớp"**: highlight `leather`, `boot` trong tiêu đề kèm điểm BM25 theo field.
8. Tab **"Hiệu năng"**: waterfall thời gian từng bước (retrieve, fuse, rerank).
9. (Tuỳ chọn) Tab **"Truy vấn ES"**: query DSL JSON.

Thông điệp: mọi kết quả đều giải thích được từng bước, không phải hộp đen.

## 2. Embedding Map (1 phút)

1. Mở <http://localhost:5173/admin/embedding-map> (nhóm **Glass-box & lab** trong admin).
2. Chọn không gian **"image-SigLIP"**: các cụm category tách rõ (ảnh là thế mạnh của SigLIP2).
3. Gõ lại `giày bốt da màu nâu` vào ô truy vấn của bản đồ: điểm truy vấn và top-k hiện lên.
4. Chuyển sang **"text-SigLIP"**: điểm truy vấn rơi xa cụm giày, giải thích vì sao dense cũ có
   Recall@10 = 0.0125 trên benchmark A1.
5. Chuyển sang **"text-E5"**: điểm truy vấn nằm trong cụm giày/boot.

Thông điệp: quyết định thêm text embedder E5 ([ADR 0001](adr/0001-text-embedder-e5.md)) có bằng chứng trực quan.

## 3. F1, tìm kiếm kết hợp ảnh + chữ (1,5 phút)

1. Bấm biểu tượng **máy ảnh** trong ô tìm kiếm, chọn **"Tìm bằng ảnh + chữ"**.
2. Tải ảnh túi xách đã chuẩn bị. Kết quả image-only hiện ra (các túi giống hình dáng).
3. Gõ `màu đen` vào ô văn bản đi kèm, nhấn **"Tìm"**.
4. Kéo thanh trượt **α** (trọng số ảnh) từ `0.9` xuống `0.5`: kết quả dịch dần sang túi màu đen;
   kéo về `1.0` để quay lại image-only.
5. Mở Inspector: bước `compose_query` (α, β), `retrieve` trên `image_vector`, `rerank` `attribute_boost`
   tăng điểm cho thuộc tính màu khớp.

## 4. Chat assistant, F2 (2 phút)

1. Bấm bong bóng **chat** ở góc phải dưới.
2. Gõ `Tìm sofa xám dưới 500` → Enter. Chỉ vào thanh tiến trình theo bước (SSE `step`):
   "Đang hiểu ý định → Đang tìm → …". Câu trả lời có **thẻ sản phẩm** ngay trong chat
   (intent `product_search`, bộ lọc trích ra `category: sofa`, `color: grey`, `price_max: 500`; giá là synthetic).
3. Gõ tiếp `Cái thứ hai đổi trả được không?` → Enter.
4. Chỉ vào dòng **câu hỏi độc lập** (rewrite) có tên sản phẩm thứ hai, và câu trả lời trích policy
   "Return Window" (30 ngày) với **citation chip**.
5. Bấm citation chip: đoạn policy gốc mở ra, có `version 2026-09`.
6. Bấm **"Xem quy trình"** để mở RAG Inspector: ứng viên theo nguồn (product / policy), sau fuse,
   **context thật sự gửi cho LLM** (tài liệu nào bị cắt vì ngân sách), prompt đã render (API key đã che),
   kết quả **kiểm tra citation** (lần thử 1/2), token usage.

## 4b. Lên kế hoạch mua sắm, F6 (1,5 phút) — tính năng RAG chính mới

1. Bấm **"Lên kế hoạch mua sắm"** trên header (trang `/plan`).
2. Chọn ví dụ **"Mình mới chuyển vào căn hộ studio, ngân sách 800 đô"** → **"Lên kế hoạch"**.
3. Chỉ vào: thanh ngân sách (tổng / ngân sách / còn lại), mỗi nhu cầu một thẻ (Cần thiết / Nếu dư
   ngân sách), món được chọn kèm **lý do có trích dẫn**, các nhu cầu "Tạm bỏ qua để vừa ngân sách".
4. Bấm một lựa chọn thay thế: tổng tiền tính lại ngay. Bấm **"Thêm tất cả vào giỏ"**.
5. Chỉ vào **mẹo chính sách** (đổi trả, giao hàng) có trích dẫn policy.
6. (Chế độ quản trị) **"Xem quy trình"**: `decompose` → `retrieve` từng nhu cầu (kèm các bước của
   pipeline tìm kiếm) → `optimize_budget` (quy hoạch động, đúng tối ưu) → `build_context` →
   `justify` / `generate` + `validate_citations`.
7. Trong chat gõ `Chuẩn bị đi biển 5 ngày cho 2 người, dưới 300 đô`: trợ lý nhận ý định
   `shopping_plan`, trả danh sách món + link **"Mở kế hoạch đầy đủ"**.

Thông điệp: RAG không chỉ để trả lời câu hỏi — nó tách nhu cầu, truy hồi nhiều lần, ràng buộc ngân
sách và giải thích bằng dẫn chứng; chạy được cả khi không có LLM (template + lý do trích xuất).

## 5. F3, so sánh sản phẩm (1 phút)

1. Trên kết quả tìm `sofa`, bấm **"Thêm vào so sánh"** ở 2 sản phẩm, rồi bấm **"So sánh (2)"**.
2. Trang `/compare`: bảng thuộc tính lấy thẳng từ dữ liệu; chỉ vào ô **"Không có dữ liệu"**
   (không suy đoán).
3. Đoạn nhận xét do RAG sinh: mỗi nhận định có citation tới thuộc tính / review / policy; bấm một chip để xác minh.

## 6. Admin console (2 phút)

0. **Pipeline & Config → "Thuật toán tìm kiếm của cửa hàng"**: đổi sang `search.bm25`, lưu; tìm lại
   trên storefront thấy pipeline đổi ngay (không restart); bấm **"Roll back to this"** để quay lại.
   **Search Playground**: so sánh `search.hybrid_linear` với `search.dense_siglip` cùng một truy vấn,
   xem overlap@10 và mở Inspector từng bên.

1. Chuyển sang cửa sổ <http://localhost:5173/admin> (đăng nhập bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD`).
2. **Policy CMS:** mở policy **"Return Window"**, bấm **"Sửa"**, đổi `30 calendar days` thành
   `14 calendar days`, bấm **"Lưu nháp"** rồi **"Publish"**.
3. Mở **Jobs**: job `reindex_policies` chạy re-embed → index `policies_a3_vN+1` → validate → switch alias;
   chờ trạng thái `succeeded`.
4. Quay lại storefront, hỏi chat: `Tôi có bao nhiêu ngày để đổi trả?` → câu trả lời **14 ngày**,
   citation mang version mới.
5. **Pipeline & Config:** bật `reranker.enabled` (cross-encoder), bấm **"Lưu thành profile"**
   đặt tên `demo-rerank`. Chỉ vào việc config được validate bằng Pydantic trước khi áp dụng, và nút **"Rollback"**.
6. **Evaluation Center:** bấm **"Chạy đánh giá"**, chọn bộ A1, chờ xong, chọn hai run (trước / sau khi bật
   reranker) và bấm **"So sánh"**: bảng Recall@10 / nDCG@10 / MRR@10 theo en/vi.
7. (Nếu còn thời gian) **Trace Explorer:** tìm theo truy vấn `sofa`, mở lại trace đầy đủ của bước 4.

Sau demo: rollback profile `demo-rerank` và đổi policy về 30 ngày (hoặc `docker compose down -v` rồi dựng lại).

## 7. Kết (30 giây)

1. Mở **Dashboard** admin: số truy vấn, p50/p95 latency theo pipeline, tỉ lệ zero-result, tỉ lệ abstain,
   tỉ lệ 👍.
2. Mở `api/reports/a1/RESULTS.md`: bảng ablation (số lấy từ `metrics.json`), nhắc qrels là nhãn seed.
3. Tóm tắt: sửa lõi (E5 + RRF), glass-box, sản phẩm hoá (Postgres, admin), ba tính năng mới F1–F3.

## Câu hỏi thường gặp khi demo

| Câu hỏi | Trả lời ngắn |
|---|---|
| Vì sao không dùng một model cho tất cả? | SigLIP2 mạnh cho ảnh/cross-modal nhưng yếu cho text ↔ text tiếng Việt; số đo ở bảng ablation. |
| Làm sao chắc câu trả lời không bịa? | Citation phải nằm trong context đã gửi, sai thì retry 1 lần; không có bằng chứng thì abstain. |
| Đổi model có phải sửa code? | Không: đổi YAML (embedders / pipelines), sinh embedding mới, index version mới, switch alias. |
| Dữ liệu giá ở đâu ra? | Tổng hợp, gắn cờ `synthetic`; ABO không có giá. |
