# CONTEXT_Deploy_Strapi.md

## 🎯 Purpose
Configuration for deploying the Strapi v5 backend to Liara (Node.js PaaS).

---

### 📂 File Structure
- `backend/liara.json` (Liara config file)
- `backend/.liaraignore` (Files to ignore during upload)

---

### ⚙️ Component Type
Backend Infrastructure & Cloud Deployment.

---

### 🌐 Data Source
- Connected to Liara Managed PostgreSQL 17.
- Uploads should be persisted in a Liara Volume (Disk).

---

### 🎨 Design Notes
- Port must be `1337`.
- Disk name `data` must be mounted to `public/uploads` to prevent media loss on restarts.

---

### 🧾 Cursor Prompt
// Create `liara.json` and `.liaraignore` in the backend directory based on @CONTEXT_Deploy_Strapi.md