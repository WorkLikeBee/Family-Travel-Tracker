# Family Travel Tracker

A web app to track which countries each family member has visited, visualized on an interactive world map.

## Features
- Track visited countries per family member on a world map
- Switch between individual and family view
- Add notes and visit dates to each country
- Add, edit, and delete family members with custom colors
- Export your travel list as a CSV file

## Tech Stack
- **Backend:** Node.js, Express
- **Database:** PostgreSQL
- **Templating:** EJS
- **Other:** express-session, dotenv

## Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [PostgreSQL](https://www.postgresql.org/) (v14+)

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/family-travel-tracker.git
   cd family-travel-tracker
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root:
   ```
   DB_PASSWORD=your_postgres_password
   SESSION_SECRET=any_random_string
   ```

4. **Set up the database**
   In PostgreSQL, create a database named `world`, then run `queries.sql`:
   ```bash
   psql -U postgres -d world -f queries.sql
   ```

5. **Start the server**
   ```bash
   node index.js
   ```
   Open [http://localhost:3000](http://localhost:3000)

## License
MIT
