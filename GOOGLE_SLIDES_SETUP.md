# Cấu hình upload PPTX → Google Drive → Google Slides

## 1. Tạo Google Apps Script

1. Mở `https://script.google.com/` và tạo project mới.
2. Dán nội dung file `google-apps-script/Code.gs` vào `Code.gs`.
3. Vào **Services** → **Add a service** → thêm **Drive API**.
4. Chọn **Deploy** → **New deployment**.
5. Chọn loại **Web app**.
6. Chọn **Execute as: Me**.
7. Chọn **Who has access: Anyone with the link**.
8. Deploy, cấp quyền Google, rồi sao chép **Web app URL**.

## 2. Khởi động server với URL đó

Trong PowerShell tại thư mục dự án:

```powershell
$env:GOOGLE_SLIDES_BRIDGE_URL = "DÁN_WEB_APP_URL_VÀO_ĐÂY"
node server.js
```

Sau đó mở `/admin.html`, upload PPTX và vào `/index.html`.

Manifest sẽ có `renderMode: "google-slides"`, `googleFileId` và `googleEmbedUrl`.

Nếu tài khoản Google Workspace không cho phép chia sẻ file với mọi người có liên kết, người dùng ngoài tổ chức có thể không xem được slide. Khi đó cần dùng tài khoản cá nhân hoặc chính sách chia sẻ phù hợp.
