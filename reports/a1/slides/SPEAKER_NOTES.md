# ShopMind A1 – Ghi chú thuyết trình

Nguồn chính: `Nhom4_BaoCao-A1.pdf`. Trang nguồn tính theo thứ tự trang PDF, gồm bìa và mục lục.

18 slide · tiếng Việt · thời lượng gợi ý 15–18 phút. Số liệu giữ theo báo cáo; không chạy lại benchmark khi tạo slide.

## 01. ShopMind

Nguồn: PDF trang 1.

Kính chào cô và các bạn. Nhóm 4 trình bày ShopMind A1 trong môn Tìm kiếm thông minh, Trường Đại học Công nghệ Thông tin, ĐHQG TP.HCM. GVHD: TS. Phạm Đỗ Kim Chi. Thành viên: Trần Văn Quang – 250104022; Nguyễn Minh Thái – 250201090; Trần Khoa – 250104010; Đinh Ngọc Phúc – 26848170. Báo cáo tháng 9/2026. Bài trình bày tập trung vào tầng truy hồi sản phẩm, kết quả thực nghiệm và giới hạn của benchmark.

## 02. Từ truy vấn đến top-k sản phẩm

Nguồn: PDF trang 3.

Người dùng có thể tìm bằng mô tả văn bản hoặc ảnh. Hệ thống trả về một danh sách sản phẩm đã xếp hạng. A1 tập trung hoàn toàn vào retrieval, để đo được đóng góp của từng thành phần trước khi thêm RAG. Câu truy vấn trên slide lấy từ phần giới hạn của báo cáo, chỉ dùng để minh họa loại truy vấn; slide không gắn cho nó một kết quả thực nghiệm mới.

## 03. Hai nhánh truy hồi, một catalog

Nguồn: PDF trang 3–4.

Phần offline bắt đầu từ ABO, chuẩn hóa metadata và ảnh, sau đó tạo embedding SigLIP2 cho văn bản và ảnh. Các bản ghi và vector được đưa vào Elasticsearch. Ở phần online, truy vấn văn bản có thể đi qua BM25, kNN trên text vector hoặc kNN trên image vector; truy vấn ảnh đi qua image encoder và image vector. Hybrid trong A1 kết hợp BM25 với dense text bằng RRF. Các chế độ độc lập cũng trả kết quả qua API. Sơ đồ này tổng hợp kiến trúc mô tả trong báo cáo, không đưa phần A2/A3 vào A1.

## 04. Tập con ABO có thể tái tạo

Nguồn: PDF trang 3–4.

ABO gốc có 147.702 product listings và 398.212 catalog images theo công trình được trích trong báo cáo. A1 sử dụng một tập con 1.500 sản phẩm, 215 category để kiểm soát pipeline và tái lập thí nghiệm. Script loại dữ liệu thiếu các trường bắt buộc, lấy mẫu với seed 42, giới hạn theo category và tải dư ứng viên để thay ảnh lỗi. search_text ghép title, description, brand, category và attributes. Quy mô nhỏ hỗ trợ so sánh nội bộ, nhưng chưa cho phép suy rộng latency sang catalog thương mại lớn.

## 05. 100 truy vấn, 200 cặp qrels

Nguồn: PDF trang 3–4.

Benchmark có 80 truy vấn text và 20 truy vấn ảnh. Các ảnh truy vấn đã được biến đổi nên không trùng byte với ảnh trong index, nhưng vẫn cùng vật thể và gần như cùng góc nhìn. Qrels có đúng 200 cặp: một positive grade 2 và một distractor grade 0 cho mỗi query. Đây là seed labels, chưa hoàn tất review độc lập bởi hai thành viên và adjudication. Các metric phù hợp để so sánh cấu hình trong cùng benchmark, chưa phải ground truth đã được con người xác nhận.

## 06. Bốn đường truy hồi cơ bản

Nguồn: PDF trang 4–5.

BM25 truy hồi lexical trên title, brand, category, description, attributes và search_text. Title được boost cao nhất; phrase match và Product ID exact match cũng được ưu tiên. Dense text mã hóa query rồi tìm trên text_vector. Cross-modal dùng cùng query text nhưng tìm trên image_vector. Image dense mã hóa ảnh người dùng và tìm trên image_vector. SigLIP2 là vision-language encoder tổng quát; hiệu quả zero-shot phụ thuộc vào representation, domain và phân bố query.

## 07. RRF kết hợp thứ hạng

Nguồn: PDF trang 4–5.

RRF cộng nghịch đảo của hằng số k cộng với rank, với k bằng 60 trong A1. Tài liệu vắng ở một danh sách không nhận đóng góp từ danh sách đó. Nhánh hybrid no RRF là cấu hình đối chứng trong đánh giá: giữ BM25 trước, rồi nối các dense candidate chưa có. Cách đối chứng này giúp phân biệt việc mở rộng tập ứng viên với việc thay đổi thứ hạng. Fusion cần tín hiệu thành phần có chất lượng hoặc bổ sung được lỗi cho nhau; kết quả A1 sẽ kiểm tra điều kiện đó.

## 08. Đối chứng từng thành phần

Nguồn: PDF trang 5.

E0 đến E4 được chạy trên cùng 80 text query; E5 chạy riêng trên 20 image query. Giữ candidate_k và top_k, đồng thời tắt reranker để tập trung vào retrieval và fusion. Recall@10 đo tỷ lệ sản phẩm relevant được đưa vào top 10. Vì mỗi query hiện chỉ có một positive, Recall trung bình cũng là tỷ lệ query có target trong top 10. MRR là trung bình nghịch đảo rank của kết quả relevant đầu tiên, bằng 0 nếu không có trong top 10. nDCG dùng gain theo relevance và chiết khấu theo vị trí, chuẩn hóa theo xếp hạng lý tưởng. Latency dùng p50/p95.

## 09. BM25 đứng đầu trên benchmark hiện tại

Nguồn: PDF trang 5–6.

Bảng giữ nguyên số liệu từ Bảng 3 của báo cáo, làm tròn bốn chữ số thập phân. BM25 đạt Recall 0,4625, nDCG 0,3568 và MRR 0,3249. Dense text và text-to-image đều chỉ đạt Recall 0,0125. Hybrid no RRF giữ nguyên chất lượng BM25; hybrid RRF giảm ở cả ba metric. Các con số chỉ áp dụng cho benchmark hiện tại với qrels dạng seed. Không trộn dòng image dense vào bảng text vì nó dùng một tập truy vấn khác.

## 10. Chất lượng tốt hơn, độ trễ thấp hơn

Nguồn: PDF trang 5–6.

Mỗi hàng có hai thanh dùng chung trục bắt đầu từ 0: p50 màu teal và p95 màu xanh nhạt. BM25 có p50 25,86 ms và p95 44,82 ms, thấp nhất trong năm cấu hình. Hybrid no RRF mất 67,04/102,53 ms và không cải thiện chất lượng; hybrid RRF mất 65,44/93,54 ms và giảm chất lượng. Tỷ số 65,44 chia 25,86 xấp xỉ 2,53. Đây là latency ở quy mô tập con A1, không phải cam kết hiệu năng production.

## 11. Khoảng cách Anh–Việt còn lớn

Nguồn: PDF trang 5–6.

BM25 đạt Recall@10 0,6444 trên 45 query tiếng Anh và 0,2286 trên 35 query tiếng Việt. Đây là phân tích cùng benchmark chứ không phải hai nghiên cứu độc lập. Báo cáo nhắc rằng canonical metadata chủ yếu là tiếng Anh và query tiếng Việt dùng bảng ánh xạ category/màu tương đối nhỏ. Vì thế không nên quy toàn bộ khoảng cách cho thuật toán BM25. Kết luận thận trọng là pipeline hiện có độ tương thích lexical tốt hơn với tiếng Anh.

## 12. Dense chỉ tìm thấy target ở 1/80 query

Nguồn: PDF trang 6.

Recall 0,0125 nhân với 80 bằng 1 query có target trong top 10; BM25 là 37 query. Hai phép quy đổi trên slide được tính từ số liệu và cấu trúc qrels trong báo cáo, không phải kết quả chạy mới. So với BM25, Recall dense giảm xấp xỉ 97,3%. Báo cáo nêu bốn khả năng: chưa thích nghi domain, representation văn bản dài, tính nhất quán model/preprocessing và benchmark chỉ có một positive. Không kết luận lỗi embedding chỉ dựa vào metric; cần ablation và kiểm tra representation trước.

## 13. Suy giảm xuất hiện khi thay đổi rank

Nguồn: PDF trang 6–7.

E0 và E3 có cùng cả ba metric. Ở phần lớn query, BM25 đã lấp đầy top 10 nên thêm ứng viên phía sau ít có cơ hội ảnh hưởng. Khi RRF cho nhánh dense tác động lên rank, Recall giảm từ 0,4625 xuống 0,3250: giảm 0,1375 điểm tuyệt đối hoặc khoảng 29,7% tương đối. nDCG và MRR giảm khoảng 48,3% và 56,5%. Đây là bằng chứng trong cấu hình A1 rằng một nhánh dense yếu có thể làm nhiễu fusion; không phải kết luận tổng quát rằng RRF luôn kém.

## 14. 1,0 trên ảnh catalog biến đổi nhẹ

Nguồn: PDF trang 5–6.

Image dense đạt cả ba metric bằng 1 trên 20 ảnh truy vấn. MRR bằng 1 ở đây cũng cho thấy relevant đầu tiên ở rank 1 trong từng query theo qrels hiện có. Kết quả hỗ trợ nhận định pipeline embedding ảnh ổn định trước crop nhẹ, resize, thay contrast và nén JPEG. Query vẫn đến từ cùng ảnh catalog, gần như cùng góc nhìn và background. Vì vậy đây là thử nghiệm robustness trên transformed catalog images, chưa chứng minh kết quả tương đương trên ảnh điện thoại, nền phức tạp hay góc chụp khác. Không so sánh trực tiếp với bảng text như cùng một tập đo.

## 15. Metric cần được đọc cùng giới hạn

Nguồn: PDF trang 7.

Qrels là giới hạn lớn nhất. Với một truy vấn chung, nhiều sản phẩm có thể hợp lý nhưng không được gắn relevance, đặc biệt bất lợi cho semantic retrieval. Cần review độc lập, adjudication và bổ sung grade 1 khi phù hợp. Ablation runner xuất 20 query có nDCG thấp nhất, nhưng nhãn tự gợi ý và trường reviewer_note trống chỉ tạo danh sách để kiểm tra thủ công. Catalog nhỏ và ảnh truy vấn không độc lập cũng hạn chế độ đại diện. Không mô tả những việc còn thiếu trong báo cáo như đã được hoàn tất.

## 16. Tra cứu Product ID đạt 100/100 top-1

Nguồn: PDF trang 7.

Theo mục 8 của PDF, kiểm tra ngày 19/09/2026 lấy 100 Product ID đầu tiên với query chữ thường. Sau Product ID boost và matching không phân biệt hoa/thường, exact ID top-1 tăng từ 0/100 lên 100/100. Đây là số liệu được trích từ báo cáo đã cung cấp, không phải lần chạy lại trong quá trình làm slide. Phải tách nó khỏi benchmark 80 text query vì cải thiện tìm định danh không tương đương cải thiện semantic retrieval; báo cáo cho biết các metric BM25 của benchmark không thay đổi.

## 17. Giữ baseline, củng cố benchmark

Nguồn: PDF trang 7–8.

Thông điệp kết luận có ba phần. Thứ nhất, A1 đã thiết lập pipeline retrieval end-to-end và khung đánh giá tách thành phần. Thứ hai, BM25 là text baseline tốt nhất ở benchmark hiện tại; dense yếu và RRF giảm chất lượng, trong khi image cần kiểm chứng bằng ảnh độc lập. Thứ ba, ưu tiên chất lượng benchmark và representation trước. Các ablation representation được báo cáo đề xuất gồm title-only, title + brand + category + attributes, và toàn bộ search_text. Sau khi pin model revision và kiểm tra encode đơn lẻ/batch, mới tiếp tục tối ưu candidate window, fusion và reranker. Những bước này là kế hoạch, chưa phải kết quả đã đo.

## 18. Nguồn và cơ sở phương pháp

Nguồn: PDF trang 9.

Nguồn chính: Nhom4_BaoCao-A1.pdf, Nhóm 4, tháng 9/2026. Các tài liệu sau được giữ theo danh mục của báo cáo, không phải một lượt nghiên cứu web mới: [1] Collins et al., ABO, CVPR 2022, DOI 10.1109/CVPR52688.2022.02045. [2] Robertson & Zaragoza, The Probabilistic Relevance Framework: BM25 and Beyond, 2009, DOI 10.1561/1500000019. [3] Karpukhin et al., Dense Passage Retrieval for Open-Domain Question Answering, EMNLP 2020, DOI 10.18653/v1/2020.emnlp-main.550. [4] Zhai et al., Sigmoid Loss for Language Image Pre-Training, ICCV 2023. [5] Tschannen et al., SigLIP 2, arXiv:2502.14786, 2025. [6] Cormack et al., Reciprocal Rank Fusion, SIGIR 2009, DOI 10.1145/1571941.1572114. [7] Järvelin & Kekäläinen, Cumulated Gain-Based Evaluation of IR Techniques, TOIS 2002, DOI 10.1145/582415.582418. [8] Thakur et al., BEIR, NeurIPS Datasets and Benchmarks 2021. [9] AWS Registry of Open Data, Amazon Berkeley Objects Dataset, ngày truy cập theo báo cáo: 29/09/2026. Xem phần ghi chú nguồn trong README; không dùng slide này để suy rộng trạng thái license.
