# Thiết kế Hệ thống: TikTok Live RPC — Chùa Online (Thắp hương & Cúng bái Phật Tương tác)

**Ngày:** 2026-10-31  
**Trạng thái:** Đã duyệt (Approved)

---

## 1. Mục tiêu
Xây dựng hệ thống phát trực tiếp tương tác (Interactive Live Stream) dành cho TikTok Live theo chủ đề **Chùa Online / Đại Hùng Bảo Điện 2.5D (Khung hình dọc 9:16)**. Người xem trên TikTok Live tương tác qua Bình luận (Comment), Thả tim (Like), Chia sẻ/Follow và Tặng quà (Gift) hoặc qua các lời gọi **JSON-RPC 2.0** để thực hiện các nghi thức tâm linh trực tuyến:
1. **Thắp hương & Dâng lễ vật + Avatar thí chủ bái Phật**
2. **Gõ mõ, Thỉnh Đại Hồng Chung & Bảng Vàng Công Đức**
3. **Thả Đèn Hoa Đăng / Sớ Cầu Nguyện kèm đọc lời khấn (TTS)**
4. **Gieo Quẻ / Xin Xăm Linh Ứng (Lắc ống xăm & giải quẻ trực tiếp)**

---

## 2. Kiến trúc Hệ thống

### 2.1. Thành phần
1. **Backend (`server.js`)**:
   - HTTP & Static Server (Express) phục vụ giao diện Live (`/`) và Bảng điều khiển RPC/Admin (`/admin`).
   - **JSON-RPC 2.0 Server** qua cả hai kênh:
     - HTTP `POST /rpc` (tích hợp dễ dàng với TikFinity, Streamer.bot, curl, webhook).
     - WebSocket `ws://localhost:3000/ws` (đồng bộ thời gian thực giữa Server, màn hình OBS Live và Admin Panel).
   - **TikTok Live Connector Bridge**: Sử dụng `tiktok-live-connector` (`WebcastPushConnection`) để lắng nghe trực tiếp các sự kiện `chat`, `like`, `gift`, `social`, `member` từ bất kỳ `@username` TikTok nào đang phát trực tiếp.
   - **Merit & Ritual Engine**:
     - Quản lý hồ sơ thí chủ, cộng điểm Công Đức, lưu trữ bền vững vào `data/merit-state.json`.
     - Bộ 24 quẻ Linh Xăm chọn lọc (Thượng Thượng Cát, Thượng Cát, Trung Cát, Đại Cát) kèm thơ giải nghĩa và lời khuyên.
     - Phân tích cú pháp bình luận tiếng Việt không dấu/có dấu để tự động kích hoạt hành động tương ứng.

2. **Màn hình Live 9:16 (`public/index.html`, `public/css/live.css`, `public/js/live.js`)**:
   - Khung chuẩn 9:16 (`1080x1920` tự co giãn theo chiều cao màn hình hoặc chế độ toàn màn hình OBS `?obs=1`).
   - **Không gian Đại Hùng Bảo Điện 2.5D**:
     - Hoành phi *"ĐẠI HÙNG BẢO ĐIỆN"* và đôi câu đối chữ vàng trên nền sơn mài đỏ.
     - **Tượng Phật Tổ Như Lai** tọa đài sen vàng, phía sau là vầng **Hào Quang Mandala** nhiều lớp xoay chuyển và phát sáng theo năng lượng Công Đức.
     - **Đại Hồng Chung** (bên trái) có hiệu ứng chấn động và sóng âm vàng lan tỏa khi thỉnh chuông.
     - **Mõ Gỗ Tâm Kinh** (bên phải) có dùi mõ gõ nhịp nhàng và chữ `+Công Đức` bay lên.
     - **Bàn thờ & Lư Hương Đồng Lưỡng Long Chầu Nguyệt**: Cắm các cây nhang thực tế (tăng số lượng khi có người thắp), đầu nhang cháy đỏ lập lòe.
     - **Mâm Lễ Vật**: Hiển thị Hoa sen, Mâm ngũ quả, Đèn lưu ly, Rồng vàng khi thí chủ dâng lễ.
     - **Ống Xăm Linh Ứng**: Đặt trên bàn thờ, rung lắc vật lý khi có người xin xăm.
   - **Canvas Particle Engine (`public/js/particles.js`)**:
     - Khói nhang uốn lượn tự nhiên bằng trường nhiễu sóng (layered sine turbulence).
     - Cánh hoa sen rơi và hạt bụi vàng tâm linh.
     - Đèn Hoa Đăng / Sớ Cầu Nguyện mang tên + avatar + lời khấn trôi từ dưới lên.
   - **Zen Audio Synthesizer & ZeroTTS (`public/js/audio.js` + `tts_worker.py`)**:
     - Web Audio API tổng hợp tiếng Mõ gỗ (Woodblock/Temple block), tiếng Đại Hồng Chung ngân vang (FM Bell Synthesis), tiếng lắc ống xăm, và nhạc nền Thiền định (Tibetan Singing Bowl Drone).
     - **ZeroTTS (`zeroweight-ai/ZeroTTS`)** chạy qua tiến trình Python thường trú (`tts_worker.py`) sử dụng giọng **`maichi` (Mai Chi)** chuẩn 48kHz tự nhiên để đọc tên thí chủ, lời cầu nguyện, cảm tạ lễ vật và lời giải quẻ xăm (có bộ đệm cache WAV tại `data/tts-cache/` và fallback Web Speech API nếu cần).
     - Web Speech API (`vi-VN`) đọc tên thí chủ và lời khấn nguyện.

3. **Bảng Điều Khiển RPC & Admin (`public/admin.html`, `public/js/admin.js`)**:
   - Kết nối / Ngắt kết nối phòng TikTok Live `@username`.
   - Bàn phím điều khiển nhanh (Quick RPC Trigger) cho từng nghi thức với thông tin thí chủ tuỳ chỉnh hoặc ngẫu nhiên.
   - Chế độ **Auto-Demo / Giả lập Luồng Đông Người Xem** để kiểm thử hoặc giữ nhiệt khi phòng live vắng.
   - Nhật ký JSON-RPC 2.0 trực tiếp và quản lý Bảng Vàng Công Đức.

---

## 3. Giao thức JSON-RPC 2.0

Mọi yêu cầu tới `POST /rpc` hoặc qua WebSocket tuân thủ chuẩn JSON-RPC 2.0:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "temple.burnIncense",
  "params": {
    "user": "Thí Chủ Minh Tâm",
    "uniqueId": "minhtam99",
    "avatar": "",
    "count": 3,
    "wish": "Cầu gia đạo bình an, vạn sự hanh thông"
  }
}
```

### Danh sách Methods:
- `temple.getState`: Lấy trạng thái hiện tại (tổng nhang, tổng công đức, Bảng Vàng, kết nối TikTok, lễ vật đang bày).
- `temple.burnIncense`: Thắp hương (`user`, `avatar`, `count`, `wish`).
- `temple.offerGift`: Dâng lễ vật (`user`, `avatar`, `giftType`: `lotus` | `fruit` | `lamp` | `dragon`, `coins`, `giftName`).
- `temple.strikeWoodenFish`: Gõ mõ tích công đức (`user`, `count`).
- `temple.ringBell`: Thỉnh Đại Hồng Chung (`user`, `count`, `wish`).
- `temple.sendPrayer`: Thả đèn hoa đăng / sớ cầu nguyện (`user`, `avatar`, `wish`, `readTts`).
- `temple.drawFortune`: Xin xăm / gieo quẻ (`user`, `avatar`, `topic`).
- `temple.grandCeremony`: Kích hoạt Đại Lễ Hào Quang Vạn Trượng (`user`, `avatar`, `giftName`, `coins`).
- `temple.updateSettings`: Cập nhật cấu hình âm thanh, TTS, tốc độ khói, chế độ tự động.
- `temple.resetMerit`: Đặt lại dữ liệu thống kê phiên live.
- `live.connect`: Kết nối tới `@username` TikTok Live.
- `live.disconnect`: Ngắt kết nối TikTok Live.
- `live.setAutoSim`: Bật/tắt chế độ giả lập người xem tự động trên server.
