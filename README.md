# Hospital Patient Visits Dashboard

Interactive dashboard for **Arogya Care Hospitals**, a fictional multispeciality hospital chain in India.
The input is one CSV file with **1,000 patient visits** (≈675 unique patients) across 10 branch cities,
10 departments and 19 doctors, October 2025 to September 2026. Amounts are in Indian Rupees (₹, shown in
thousand / lakh / crore).

Plain HTML, CSS and JavaScript: no framework, no build step, no chart library (charts are hand-drawn SVG).

## What's in the dashboard

- Filters for period, department, city, gender and visit type that apply to every card
- Patient satisfaction (average rating and star distribution), plus KPIs for revenue, visits, follow-up rate
  and average waiting time, each with a monthly sparkline and change vs. the prior 3 months
- Monthly trend: visits, revenue, wait time, satisfaction, follow-up %
- Feedback sentiment, and patient mix by gender, age group and visits per patient
- Revenue, satisfaction, follow-up rate and top complaint per department
- Key insights computed from the data under the active filters
- Top health issues (follow-up rate, average bill) and payment mode share (UPI, cash, card, insurance,
  Ayushman Bharat, CGHS)
- Feedback topics by sentiment, and waiting-time distribution vs. satisfaction
- Sortable performance table by department, doctor, city, gender, age group, visit type and payment mode
- Visit records with search and tabs (all, follow-up needed sorted by due date, negative / neutral / positive)
- Light/dark theme, print / PDF, and **Load CSV** (button or drag & drop) to view your own file

## Project structure

```
index.html                 dashboard page
assets/style.css           styling (light and dark theme)
assets/app.js              CSV parsing, topic rules, metrics, SVG charts, interaction
data/patient_visits.csv    input data: 1,000 patient visits
scripts/generate_data.py   regenerates the CSV (synthetic, seeded)
```

## Run it

**GitHub Pages:** push the repo, then *Settings → Pages → Deploy from a branch → main / root*.
The dashboard is served at `https://<your-user>.github.io/<repo-name>/`.

**Locally:** browsers block `fetch()` from `file://`, so serve the folder:

```bash
python -m http.server 8000
```

then open http://localhost:8000. (Opening `index.html` directly still works: click **Load CSV** and pick
`data/patient_visits.csv`.) To load another file in the repo, use `?data=`, e.g. `index.html?data=data/2027.csv`.

## CSV columns

| Column | Example | Notes |
|---|---|---|
| visit_id | V-00001 | |
| patient_id | PT-00097 | same patient can have several visits |
| patient_name | Divya Thakur | |
| gender | Female | Male / Female / Other |
| age | 21 | |
| age_group | 15-29 | 0-14, 15-29, 30-44, 45-59, 60+ (derived from age if empty) |
| city, state | Pune, Maharashtra | hospital branch |
| department | General Medicine | **required** |
| issue | Hypertension | diagnosis / reason for visit |
| doctor_name | Dr. Imran Qureshi | |
| visit_date | 2025-10-01 | **required**; YYYY-MM-DD or DD-MM-YYYY |
| visit_time | 08:45 | |
| visit_type | OPD | OPD, Follow-up, Emergency, IPD admission, Teleconsultation |
| wait_time_min | 40 | registration to consultation |
| length_of_stay_days | 0 | IPD only |
| consultation_fee, test_charges, medicine_charges, procedure_charges | 500, 0, 300, 0 | ₹ |
| total_amount | 800 | **required**, ₹ |
| payment_mode | UPI | UPI, Cash, Debit/Credit card, Health insurance, Ayushman Bharat (PM-JAY), CGHS |
| follow_up_needed | Yes | Yes / No |
| follow_up_date | 2025-10-31 | empty when not needed |
| satisfaction_rating | 4 | 1–5, empty when no feedback |
| feedback | The doctor listened carefully… | free text |
| sentiment | Positive | optional; derived from rating if empty (4–5 / 3 / 1–2) |

## Calculation notes

- Satisfaction and sentiment shares are computed only from visits with feedback.
- A wait over 45 minutes counts as long (`LONG_WAIT` in `assets/app.js`).
- Revenue "via insurance/schemes" is the total of visits paid by health insurance, Ayushman Bharat or CGHS.
- Feedback topics are not a column in the CSV. They are grouped from keywords in the feedback text; the first
  matching rule wins. Rules are in `TOPICS` at the top of `assets/app.js`.
- Groups with fewer than 20 feedback are greyed out as a small sample and are not used for insights.
- KPI changes compare the last 3 months with the 3 months before.
- Gender and age-group mix count each patient once.

## Regenerating the data

```bash
python scripts/generate_data.py --visits 1000 --seed 42
```

All patients, doctors, the hospital name and every amount are synthetic and for demonstration only.
