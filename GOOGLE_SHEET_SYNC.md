# Google Sheet Cloud Sync

## 1. Tao Google Sheet

Tao 1 Google Sheet moi, dat ten tuy y.

Vao `Extensions > Apps Script`.

## 2. Dan code Apps Script

Copy toan bo noi dung file `google-apps-script.js` vao Apps Script.

Trong ham `setup()` doi token:

```js
const token = 'doi-token-nay';
```

Thanh token rieng cua ban, vi du:

```js
const token = 'Hanoi@123-cloud';
```

Bam `Save`, chon ham `setup`, bam `Run` mot lan va cap quyen.

## 3. Deploy Web App

Vao `Deploy > New deployment`.

Chon loai `Web app`.

Thiet lap:

- Execute as: `Me`
- Who has access: `Anyone`

Bam `Deploy`, copy URL dang:

```text
https://script.google.com/macros/s/.../exec
```

## 4. Cau hinh trong app

Mo app, dang nhap QTV.

Bam `Cloud`.

Nhap:

- Apps Script Web App URL
- Token da dat trong `setup()`

Bam `Luu cau hinh`.

## 5. Cach dung

- `Luu cloud`: day du lieu tren may hien tai len Google Sheet.
- `Tai cloud`: tai du lieu tu Google Sheet ve may dang dung.

Nen thao tac theo luong:

1. May chinh bam `Luu cloud`.
2. May khac bam `Tai cloud`.

Neu nhieu may cung sua cung luc, ban bam `Luu cloud` sau se ghi de ban cloud truoc.
