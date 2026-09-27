# Software Management System — Final Secure Version

## What is different

This version does **not** contain a default Admin, Manager, or Team Leader account.

### First launch

1. Configure MySQL.
2. Start/deploy the application.
3. Open the site.
4. The application shows **Create Main Admin**.
5. Enter your own:
   - Full name
   - Email
   - Username
   - Password
6. After creation, the Admin setup endpoint is permanently locked.

### Admin

The Main Admin can create:
- Manager accounts
- Team Leader accounts

The Admin can also enable/disable those accounts.

The Main Admin cannot be disabled from the UI.

### Security

- Passwords are hashed with bcrypt.
- Authentication is server-side.
- HTTP-only session cookies are used.
- Role authorization is enforced on server endpoints.
- Manager and Team Leader cannot access Admin user-management APIs.
- No passwords are stored in the frontend.
- No demo credentials are displayed after deployment.

## Render deployment

Create a **Web Service**, not a Static Site.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Root directory:

```text
(empty)
```

Add:

```text
NODE_ENV=production
SESSION_SECRET=<long random secret>
DATABASE_URL=<your MySQL connection URL>
```

A MySQL database is required for persistent accounts.

## Local setup

```bash
npm install
npm start
```

Then open:

```text
http://localhost:10000
```

## Project structure

```text
Software-Management-System-FINAL/
├── server.js
├── package.json
├── .env.example
├── README.md
├── database/
│   └── schema.sql
└── public/
    └── index.html
```

## Important

This project intentionally does not include a hard-coded Admin password. Create your own Admin on first launch.
