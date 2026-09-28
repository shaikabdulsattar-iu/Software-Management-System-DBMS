# Software Management System — Runnable Version

This version is ready for local development and can also use MySQL for deployment.

## 1. Run locally — no MySQL required

Open a terminal in this folder and run:

```bash
npm install
npm start
```

Then open:

```text
http://localhost:10000
```

On first launch, the application shows **Create Main Admin**. Create your own account and then sign in.

For local development, accounts are stored in:

```text
data/users.json
```

This file is created automatically. Do not commit real production passwords.

## 2. Run with MySQL

If `DATABASE_URL` or the `DB_HOST` variables are configured, the application automatically uses MySQL instead of local JSON storage.

Copy `.env.example` to `.env` and configure:

```text
NODE_ENV=development
PORT=10000
SESSION_SECRET=replace-with-a-long-random-secret
DATABASE_URL=mysql://USERNAME:PASSWORD@HOST:3306/software_management
```

Or use:

```text
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=software_management
DB_SSL=false
```

The server creates the `users` table automatically. `database/schema.sql` is also included if you want to create the database manually.

## 3. Render deployment

Create a **Web Service**.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Environment variables:

```text
NODE_ENV=production
SESSION_SECRET=<long random secret>
DATABASE_URL=<your MySQL connection URL>
```

For production, use MySQL rather than local JSON storage because local filesystem data may not be persistent on hosting platforms.

## 4. Project structure

```text
Software-Management-System-FINAL/
├── server.js
├── package.json
├── .env.example
├── README.md
├── database/
│   └── schema.sql
├── data/
│   └── users.json          # created automatically for local mode
└── public/
    └── index.html
```

## 5. Main features

- Main Admin setup on first launch
- Manager and Team Leader account creation
- Role-based access
- Employee management
- Project management
- Team management
- Team member assignments
- Sprint management
- Task management
- Bug tracking
- Reports dashboard
- Browser-local project data using localStorage
- Optional MySQL authentication persistence
- bcrypt password hashing
- HTTP-only sessions

## 6. If you get `npm` is not recognized

Install Node.js LTS, restart the terminal, and run:

```bash
node -v
npm -v
```

Then:

```bash
npm install
npm start
```
