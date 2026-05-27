import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const db = new pg.Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        user: "postgres",
        host: "localhost",
        database: "world",
        password: process.env.DB_PASSWORD,
        port: 5432,
      }
);

db.on("error", (err) => console.error("DB pool error:", err.message));

db.query("SELECT 1").then(() => console.log("DB connected")).catch((err) => console.error("DB connection failed:", err.message));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(session({
  secret: process.env.SESSION_SECRET || "family-travel-secret",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
}));

let users = [];

async function getVisited(userId) {
  const result = await db.query(
    `SELECT vc.id, vc.country_code, c.country_name, vc.notes, vc.visited_date
     FROM visited_countries vc
     JOIN countries c ON vc.country_code = c.country_code
     WHERE vc.user_id = $1
     ORDER BY c.country_name, vc.visited_date`,
    [userId]
  );
  return result.rows;
}

async function getCurrentUser(req) {
  const result = await db.query("SELECT * FROM users");
  users = result.rows;
  if (!req.session.currentUserId && users.length > 0) {
    req.session.currentUserId = users[0].id;
  }
  return users.find((user) => user.id == req.session.currentUserId);
}

async function getCountryCounts() {
  const result = await db.query(
    "SELECT user_id, COUNT(DISTINCT country_code) AS count FROM visited_countries GROUP BY user_id"
  );
  const counts = {};
  result.rows.forEach((row) => {
    counts[row.user_id] = parseInt(row.count);
  });
  return counts;
}

async function getFamilyVisited() {
  const result = await db.query(
    `SELECT vc.country_code, u.color, u.id AS user_id
     FROM visited_countries vc
     JOIN users u ON vc.user_id = u.id
     ORDER BY u.id`
  );
  const familyCountries = {};
  result.rows.forEach((row) => {
    if (!familyCountries[row.country_code]) {
      familyCountries[row.country_code] = row.color;
    }
  });
  return familyCountries;
}

async function getUserStats(userId) {
  const totalResult = await db.query("SELECT COUNT(*) AS total FROM countries");
  const totalCountries = parseInt(totalResult.rows[0].total);

  const visitedResult = await db.query(
    "SELECT COUNT(DISTINCT country_code) AS count FROM visited_countries WHERE user_id = $1",
    [userId]
  );
  const countriesVisited = parseInt(visitedResult.rows[0].count);

  let continentsCovered = 0;
  try {
    const continentsResult = await db.query(
      `SELECT COUNT(DISTINCT c.continent) AS count
       FROM visited_countries vc
       JOIN countries c ON vc.country_code = c.country_code
       WHERE vc.user_id = $1`,
      [userId]
    );
    continentsCovered = parseInt(continentsResult.rows[0].count) || 0;
  } catch (_) {}

  const percentVisited = totalCountries > 0
    ? ((countriesVisited / totalCountries) * 100).toFixed(1)
    : "0.0";

  return { countriesVisited, continentsCovered, percentVisited };
}

app.get("/", async (req, res) => {
  try {
  const currentUser = await getCurrentUser(req);
  const userId = req.session.currentUserId;
  const familyView = req.session.familyView || false;
  const countryCounts = await getCountryCounts();
  const error = req.query.error || null;
  const success = req.query.success || null;
  const allCountriesResult = await db.query("SELECT country_name FROM countries ORDER BY country_name");
  const allCountries = allCountriesResult.rows.map((r) => r.country_name);
  const stats = await getUserStats(userId);
  const familyCountries = familyView ? await getFamilyVisited() : {};

  if (users.length == 0) {
    res.render("index.ejs", {
      users, total: 0, color: "teal",
      currentUserId: userId, countryCounts,
      visitedDetails: [], countries: [],
      error, success, allCountries, stats,
      familyView, familyCountries,
    });
  } else {
    const visitedDetails = await getVisited(userId);
    const countries = [...new Set(visitedDetails.map((r) => r.country_code))];
    res.render("index.ejs", {
      countries, total: countries.length,
      users, color: currentUser.color,
      currentUserId: userId, countryCounts,
      visitedDetails, error, success, allCountries, stats,
      familyView, familyCountries,
    });
  }
  } catch (err) {
    console.error("ROUTE ERROR:", err.message);
    res.status(500).send("Error: " + err.message);
  }
});

app.post("/family-view", (req, res) => {
  req.session.familyView = !req.session.familyView;
  res.redirect("/");
});

app.post("/add", async (req, res) => {
  const input = req.body["country"];
  const userId = req.session.currentUserId;

  if (!input || !input.trim()) {
    return res.redirect("/?error=Please+enter+a+country+name.");
  }

  try {
    const result = await db.query(
      "SELECT country_code FROM countries WHERE LOWER(country_name) LIKE '%' || $1 || '%';",
      [input.trim().toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.redirect("/?error=Country+not+found.+Try+a+different+name.");
    }
    const countryCode = result.rows[0].country_code;

    await db.query(
      "INSERT INTO visited_countries (country_code, user_id, notes, visited_date) VALUES ($1, $2, $3, $4)",
      [countryCode, userId, "", null]
    );
    res.redirect("/?success=Country+added+successfully!");
  } catch (err) {
    res.redirect("/?error=Country+not+found.+Try+a+different+name.");
  }
});

app.post("/delete", async (req, res) => {
  try {
    await db.query(
      "DELETE FROM visited_countries WHERE id = $1 AND user_id = $2",
      [req.body.id, req.session.currentUserId]
    );
  } catch (err) {
    return res.redirect("/?error=Could+not+delete+country.");
  }
  res.redirect("/");
});

app.post("/update-note", async (req, res) => {
  const { id, notes, visited_date } = req.body;
  try {
    await db.query(
      "UPDATE visited_countries SET notes = $1, visited_date = $2 WHERE id = $3 AND user_id = $4",
      [notes || "", visited_date || null, id, req.session.currentUserId]
    );
  } catch (err) {
    return res.redirect("/?error=Could+not+save+note.");
  }
  res.redirect("/");
});

app.post("/user", async (req, res) => {
  if (req.body.add === "new") {
    res.render("new.ejs");
  } else {
    req.session.currentUserId = req.body.user;
    res.redirect("/");
  }
});

app.post("/new", async (req, res) => {
  try {
    const result = await db.query(
      "INSERT INTO users (name, color) VALUES ($1, $2) RETURNING *;",
      [req.body.name, req.body.color]
    );
    req.session.currentUserId = result.rows[0].id;
  } catch (err) {
    return res.redirect("/?error=Could+not+create+user.");
  }
  res.redirect("/");
});

app.post("/edit-user", async (req, res) => {
  const { id, name, color } = req.body;
  try {
    await db.query("UPDATE users SET name = $1, color = $2 WHERE id = $3", [name, color, id]);
  } catch (err) {
    return res.redirect("/?error=Could+not+update+user.");
  }
  res.redirect("/");
});

app.post("/delete-user", async (req, res) => {
  const { id } = req.body;
  try {
    await db.query("DELETE FROM visited_countries WHERE user_id = $1", [id]);
    await db.query("DELETE FROM users WHERE id = $1", [id]);
    if (req.session.currentUserId == id) {
      const result = await db.query("SELECT id FROM users LIMIT 1");
      req.session.currentUserId = result.rows.length > 0 ? result.rows[0].id : null;
    }
  } catch (err) {
    return res.redirect("/?error=Could+not+delete+user.");
  }
  res.redirect("/");
});

app.get("/export/csv", async (req, res) => {
  const userId = req.session.currentUserId;
  const userResult = await db.query("SELECT name FROM users WHERE id = $1", [userId]);
  const userName = userResult.rows[0]?.name || "user";

  const result = await db.query(
    `SELECT c.country_name, vc.visited_date, vc.notes
     FROM visited_countries vc
     JOIN countries c ON vc.country_code = c.country_code
     WHERE vc.user_id = $1
     ORDER BY c.country_name, vc.visited_date`,
    [userId]
  );

  const header = "Country,Date Visited,Notes\n";
  const body = result.rows.map((row) => {
    const country = `"${row.country_name}"`;
    const date = row.visited_date
      ? new Date(row.visited_date).toISOString().split("T")[0]
      : "";
    const notes = `"${(row.notes || "").replace(/"/g, '""')}"`;
    return `${country},${date},${notes}`;
  }).join("\n");

  const filename = `${userName.toLowerCase().replace(/\s+/g, "-")}-travel-export.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(header + body);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
