# ShopMind A1 – Slide báo cáo Nhóm 4

## Bản rút gọn 12 slide

Bản trình bày khoảng 10–12 phút, giữ kiến trúc, dataset, benchmark, phương pháp, kết quả và giới hạn thực nghiệm. Chi tiết Anh–Việt, kiểm tra Product ID và tài liệu tham khảo nằm trong ghi chú thuyết trình.

- [PowerPoint 12 slide](ShopMind_A1_12slides.pptx)
- [PDF 12 trang](ShopMind_A1_12slides.pdf)
- [HTML 12 slide](ShopMind_A1_12slides.html)
- [Ghi chú thuyết trình](SPEAKER_NOTES_12slides.md)

## Bản đầy đủ 18 slide

18 slide tiếng Việt, tỉ lệ 16:9, phù hợp trình bày khoảng 15–18 phút. Thiết kế nền giấy, xanh navy/teal; dùng sơ đồ, bảng và biểu đồ để trình bày số liệu.

- [PowerPoint chỉnh sửa được](ShopMind_A1.pptx): văn bản, hình khối, bảng kết quả và thanh biểu đồ đều có thể chỉnh sửa; có ghi chú cho toàn bộ slide.
- [PDF để xem/chia sẻ](ShopMind_A1.pdf): xuất từ bản HTML, có font nhúng.
- [Trình chiếu trên trình duyệt](ShopMind_A1.html): chạy offline, không phụ thuộc mạng.
- [Ghi chú thuyết trình](SPEAKER_NOTES.md): lời dẫn và giải thích từng slide.
- [Dữ liệu nội dung](content.json) và [script tạo slide](build_slides.py).

## Trình chiếu HTML

Mở `ShopMind_A1.html` bằng trình duyệt. Dùng ←/→, ↑/↓, PageUp/PageDown hoặc Space để chuyển slide; Home/End để về đầu/cuối; N để mở ghi chú; F để bật/tắt toàn màn hình. Hỗ trợ cuộn chuột, vuốt ngang và chế độ giảm chuyển động của hệ điều hành. Có thể mở bằng URL `#9` để vào slide 9.

## Phạm vi và nguồn

Nguồn chính: `/Users/yuji/Downloads/Nhom4_BaoCao-A1.pdf`, báo cáo bài tập 1 của Nhóm 4, môn Tìm kiếm thông minh, UIT – ĐHQG TP.HCM, tháng 9/2026. Số trang nguồn trên slide tính theo thứ tự trang PDF, gồm bìa và mục lục, khác số trang in trong báo cáo.

Chỉ trình bày A1: BM25, SigLIP2 text/image embeddings, kNN, RRF, dataset, benchmark và phân tích kết quả. Các số liệu được trích từ PDF; benchmark và kiểm tra hồi quy Product ID không được chạy lại trong quá trình tạo slide. Hai phép quy đổi 1/80 và 37/80 được tính từ Recall@10 với một positive/query.

Giữ các giới hạn của báo cáo: qrels là seed labels chưa hoàn tất review độc lập; các giả thuyết về dense chưa được xác nhận; 20 image query là ảnh catalog biến đổi nhẹ; exact Product ID lookup được báo cáo riêng. Các ablation bổ sung trên slide kết luận là kế hoạch, chưa phải kết quả đã thực hiện. Slide tài liệu tham khảo giữ các mục [1]–[9] của PDF; không xác minh lại trạng thái giấy phép dữ liệu qua web.

Backend ở `assignment-a1`; giao diện trong repo `test-ui` ở `main` (A1). Các thay đổi A3 chưa commit ở backend đã được giữ trong stash có tên `codex: preserve A3 work before A1 slides 2026-10-05`.

## Tạo lại bản HTML/PowerPoint

Yêu cầu Python 3.11+ và `python-pptx`:

```bash
python3 reports/a1/slides/build_slides.py
```

Chỉnh nội dung trong `SLIDES`, số liệu trong `TEXT_RESULTS`, màu PowerPoint trong `COLORS`, màu và kích thước HTML trong `CSS`. HTML nhúng font Georgia/Verdana từ macOS khi có; có font dự phòng. Script tạo lại HTML, PPTX, JSON và ghi chú, không tự ghi đè PDF. Có thể xuất PDF từ PowerPoint hoặc in HTML bằng trình duyệt ở chế độ ngang 16:9.

## Kiểm tra

`validation.json` ghi kết quả kiểm tra tự động trên HTML tại 1920×1080, 1280×720, 768×1024, 375×667 và 667×375, kèm kiểm tra phím điều hướng, chuyển động bình thường/giảm chuyển động, ghi chú và lỗi JavaScript. PowerPoint/PDF được kiểm tra đủ 18 slide, ghi chú PowerPoint đầy đủ, số liệu và bố cục được xem lại bằng bản render.
