"""Generate a synthetic patient-visit dataset for an Indian multispeciality hospital chain.

Output: data/patient_visits.csv (read by index.html at runtime).

Usage (from the project root):
    python scripts/generate_data.py               # 1000 visits, seed 42
    python scripts/generate_data.py --visits 2000 --seed 7

All names, visits and amounts are fictional. Feedback text is assembled from templates so
that each comment mentions one topic; the dashboard re-derives that topic from keywords
(see TOPICS in assets/app.js).
"""
import argparse
import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "patient_visits.csv"

START = datetime(2025, 10, 1)
END = datetime(2026, 9, 30)

# branch city, state, weight, extra wait minutes
CITIES = [
    ("Mumbai", "Maharashtra", 15, 12), ("Delhi", "Delhi", 14, 15), ("Bengaluru", "Karnataka", 13, 8),
    ("Hyderabad", "Telangana", 10, 6), ("Chennai", "Tamil Nadu", 10, 5), ("Kolkata", "West Bengal", 9, 10),
    ("Pune", "Maharashtra", 8, 4), ("Ahmedabad", "Gujarat", 8, 3), ("Jaipur", "Rajasthan", 7, 7), ("Lucknow", "Uttar Pradesh", 6, 14),
]

# department: (weight, base consultation fee, issues, doctors, age range, sex filter)
# issue: (name, weight, chronic -> follow-up likely, test charge range)
DEPTS = {
    "General Medicine": (20, 500, [("Viral fever", 5, 0.2, (300, 1500)), ("Dengue", 2, 0.7, (1500, 4000)), ("Typhoid", 2, 0.7, (800, 2500)),
                                    ("Hypertension", 3, 0.8, (500, 2000)), ("Acidity / Gastritis", 3, 0.2, (0, 800))],
                         ["Dr. Rajesh Kumar", "Dr. Sunita Rao", "Dr. Imran Qureshi"], (16, 85), None),
    "Pediatrics": (12, 600, [("Fever", 5, 0.2, (200, 1000)), ("Cough & cold", 5, 0.1, (0, 600)), ("Vaccination", 4, 0.9, (0, 0)),
                             ("Diarrhoea", 2, 0.3, (300, 1200))],
                   ["Dr. Meera Iyer", "Dr. Arjun Nair"], (0, 14), None),
    "Orthopedics": (11, 800, [("Knee pain", 4, 0.7, (800, 3500)), ("Lower back pain", 4, 0.6, (800, 3000)), ("Fracture", 2, 0.9, (1200, 4000)),
                              ("Arthritis", 3, 0.8, (1000, 3500))],
                    ["Dr. Vikram Singh", "Dr. Anil Deshmukh"], (18, 85), None),
    "Cardiology": (8, 1200, [("Chest pain", 3, 0.8, (2500, 8000)), ("Hypertension", 4, 0.8, (800, 3000)), ("Arrhythmia", 2, 0.9, (2500, 7000))],
                   ["Dr. Suresh Menon", "Dr. Kavita Joshi"], (35, 88), None),
    "Gynecology": (24, 900, [("Pregnancy check-up", 5, 0.95, (800, 3500)), ("PCOS", 3, 0.7, (1200, 4000)), ("Menstrual disorder", 2, 0.5, (500, 2500))],
                   ["Dr. Priya Sharma", "Dr. Nandini Reddy"], (18, 48), "Female"),
    "Dermatology": (7, 700, [("Skin allergy", 4, 0.4, (0, 1200)), ("Acne", 3, 0.6, (0, 600)), ("Fungal infection", 4, 0.5, (0, 800))],
                    ["Dr. Ayesha Khan", "Dr. Rohit Malhotra"], (12, 70), None),
    "ENT": (6, 700, [("Sinusitis", 3, 0.5, (500, 2500)), ("Ear infection", 3, 0.3, (300, 1200)), ("Tonsillitis", 2, 0.3, (300, 1200))],
            ["Dr. Ganesh Patil"], (4, 80), None),
    "Endocrinology": (7, 1000, [("Type 2 diabetes", 6, 0.95, (900, 3500)), ("Thyroid disorder", 4, 0.9, (700, 2500))],
                      ["Dr. Farhan Siddiqui", "Dr. Lakshmi Venkatesh"], (25, 85), None),
    "Pulmonology": (5, 900, [("Asthma", 3, 0.8, (800, 3000)), ("COPD", 2, 0.9, (1500, 4500)), ("Tuberculosis", 1, 0.95, (1000, 3500))],
                    ["Dr. Harish Chandra"], (10, 88), None),
    "Ophthalmology": (6, 700, [("Cataract", 3, 0.9, (1000, 3000)), ("Conjunctivitis", 3, 0.2, (0, 500)), ("Refractive error", 4, 0.3, (300, 800))],
                      ["Dr. Deepa Krishnan", "Dr. Sameer Bhatt"], (5, 88), None),
}
ADULT_WEIGHT_BY_AGE = {"Cardiology": lambda a: 3 if a >= 50 else 1, "Ophthalmology": lambda a: 3 if a >= 55 else 1,
                       "Orthopedics": lambda a: 2 if a >= 45 else 1}

VISIT_TYPES = [("OPD", 70), ("Emergency", 9), ("IPD admission", 7), ("Teleconsultation", 6)]  # "Follow-up" is spawned
PAY_OPD = [("UPI", 40), ("Cash", 22), ("Debit/Credit card", 18), ("Health insurance", 9), ("Ayushman Bharat (PM-JAY)", 7), ("CGHS", 4)]
PAY_IPD = [("UPI", 12), ("Cash", 6), ("Debit/Credit card", 14), ("Health insurance", 45), ("Ayushman Bharat (PM-JAY)", 16), ("CGHS", 7)]

FIRST_M = ("Aarav Aditya Ajay Amit Anand Arjun Ashok Deepak Dinesh Farhan Ganesh Harsh Imran Karan Kiran Manoj Mohan Naveen "
           "Nikhil Pradeep Rahul Rajesh Ravi Rohan Sachin Sandeep Sanjay Suresh Tarun Varun Vijay Vikas Yash Zaid").split()
FIRST_F = ("Aditi Aisha Anjali Ananya Asha Bhavna Deepa Divya Fatima Gauri Isha Kavya Lakshmi Meena Neha Nisha Pooja "
           "Priya Radha Rekha Ritu Sakshi Sana Shreya Sneha Sunita Swati Tanvi Usha Vandana Zoya").split()
LAST = ("Agarwal Banerjee Bhat Chauhan Das Desai Gupta Iyer Jain Joshi Kapoor Khan Kulkarni Kumar Mehta Mishra Nair Patel "
        "Pillai Rao Reddy Saxena Shah Sharma Shetty Singh Sinha Srinivasan Thakur Verma Yadav").split()

# Feedback templates per topic and polarity; each uses only its own topic's keywords.
T = {
    "wait": {
        "pos": ["Hardly any waiting, got my turn on time.", "Quick registration and very short wait."],
        "neu": ["Had to wait around 40 minutes, manageable.", "Waiting time was okay for a weekday."],
        "neg": ["Waited more than two hours even with an appointment.", "Very long queue, the waiting area was overcrowded.",
                "Token system is a mess, waited forever."],
    },
    "doctor": {
        "pos": ["{d} explained everything patiently.", "The doctor listened carefully and the diagnosis was clear.",
                "Very experienced doctor, I feel much better now."],
        "neu": ["Consultation was okay but felt a little rushed.", "The doctor was fine, nothing special."],
        "neg": ["The doctor barely spent five minutes with me.", "{d} did not explain the diagnosis properly.",
                "Felt the consultation was rushed and my questions were ignored."],
    },
    "staff": {
        "pos": ["Nursing staff were caring and polite.", "Reception staff were very helpful."],
        "neu": ["Staff were okay, some were busy and short with us.", "The nurses were polite but slow."],
        "neg": ["Reception staff were rude and unhelpful.", "Nurses did not respond when we called them.",
                "Staff behaviour at the front desk was very poor."],
    },
    "billing": {
        "pos": ["Billing was transparent and the charges were reasonable.", "Cashless insurance approval was smooth and fast."],
        "neu": ["Charges are a bit high but expected for a private hospital.", "Billing took some time but was correct."],
        "neg": ["Charges were too high and the bill had extra items.", "Insurance claim approval took a whole day.",
                "Billing counter overcharged us, had to argue for a refund."],
    },
    "clean": {
        "pos": ["The hospital is very clean and well maintained.", "Clean washrooms and hygienic wards."],
        "neu": ["Cleanliness is average, the corridors could be better.", "Hygiene was okay overall."],
        "neg": ["Washrooms were dirty and smelly.", "Poor hygiene in the ward, dustbins overflowing."],
    },
    "lab": {
        "pos": ["Lab reports came on time and pharmacy had all medicines.", "Quick blood test and reports were sent on WhatsApp."],
        "neu": ["Lab report was delayed by a few hours.", "The pharmacy had most medicines in stock."],
        "neg": ["Lab reports were delayed by two days.", "Pharmacy did not have the prescribed medicines.",
                "Had to repeat the blood test because the sample was lost."],
    },
}
CLOSERS = {"pos": ["", "", " Thank you!", " Highly recommended.", " Will come again if needed."],
           "neu": ["", "", " Overall okay."], "neg": ["", " Very disappointed.", " Not recommended.", " Expected better."]}

FIELDS = ["visit_id", "patient_id", "patient_name", "gender", "age", "age_group", "city", "state", "department", "issue",
          "doctor_name", "visit_date", "visit_time", "visit_type", "wait_time_min", "length_of_stay_days",
          "consultation_fee", "test_charges", "medicine_charges", "procedure_charges", "total_amount", "payment_mode",
          "follow_up_needed", "follow_up_date", "satisfaction_rating", "feedback", "sentiment"]


def wpick(pairs):
    return random.choices([p[0] for p in pairs], weights=[p[1] for p in pairs])[0]


def age_group(a):
    return "0-14" if a <= 14 else "15-29" if a <= 29 else "30-44" if a <= 44 else "45-59" if a <= 59 else "60+"


def make_patient(pid):
    city, state, _, _ = random.choices(CITIES, weights=[c[2] for c in CITIES])[0]
    gender = random.choices(["Male", "Female", "Other"], weights=[49, 50, 1])[0]
    age = random.choices([random.randint(0, 14), random.randint(15, 44), random.randint(45, 88)], weights=[18, 44, 38])[0]
    first = random.choice(FIRST_F if gender == "Female" else FIRST_M if gender == "Male" else FIRST_M + FIRST_F)
    return {"patient_id": f"PT-{pid:05d}", "patient_name": f"{first} {random.choice(LAST)}", "gender": gender, "age": age,
            "city": city, "state": state}


def eligible(p):
    out = []
    for name, (w, *_rest) in DEPTS.items():
        lo, hi = DEPTS[name][4]
        sex = DEPTS[name][5]
        if lo <= p["age"] <= hi and (sex is None or sex == p["gender"]):
            out.append((name, w * ADULT_WEIGHT_BY_AGE.get(name, lambda a: 1)(p["age"])))
    return out


def rand_date():
    # more visits in monsoon (Jul-Sep: dengue, viral fever) and winter (Dec-Jan)
    days = (END - START).days + 1
    while True:
        d = START + timedelta(days=random.randrange(days))
        boost = {7: 1.4, 8: 1.5, 9: 1.4, 12: 1.2, 1: 1.2}.get(d.month, 1.0)
        if random.random() < boost / 1.5:
            return d


def make_visit(p, date, vtype, dept=None, doctor=None, issue=None):
    city_wait = next(c[3] for c in CITIES if c[0] == p["city"])
    if dept is None:
        dept = wpick(eligible(p))
    _, base_fee, issues, doctors, _, _ = DEPTS[dept]
    if issue is None:
        issue_t = random.choices(issues, weights=[i[1] for i in issues])[0]
    else:
        issue_t = next(i for i in issues if i[0] == issue)
    issue, _, chronic, (tlo, thi) = issue_t
    doctor = doctor or random.choice(doctors)
    fee = base_fee + (200 if doctors.index(doctor) == 0 else 0)  # senior consultant charges more

    if vtype == "Emergency":
        wait = random.randint(2, 20)
    elif vtype == "Teleconsultation":
        wait = random.randint(0, 15)
    else:
        # waits improve over the year after a token-system upgrade; Monday rush
        months_in = (date.year - START.year) * 12 + date.month - START.month
        wait = max(5, int(random.gauss(38 + city_wait - 1.6 * months_in + (15 if date.weekday() == 0 else 0), 18)))

    stay, proc = 0, 0
    tests = random.randint(tlo // 100, thi // 100) * 100 if thi and random.random() < 0.75 else 0
    meds = random.randint(1, 25) * 100 if random.random() < 0.8 else 0
    if vtype == "Teleconsultation":
        fee, tests = int(fee * 0.7), 0
    elif vtype == "Follow-up":
        fee = int(fee * 0.5)
    elif vtype == "Emergency":
        fee, proc = fee + 1000, random.choice([0, 0, 1500, 3000, 5000])
    elif vtype == "IPD admission":
        stay = random.randint(1, 7)
        proc = stay * random.randint(30, 60) * 100 + random.choice([0, 0, 25000, 45000, 80000])
        tests += random.randint(20, 80) * 100
        meds += stay * random.randint(8, 20) * 100
    total = fee + tests + meds + proc

    pay = wpick(PAY_IPD if vtype == "IPD admission" or total > 20000 else PAY_OPD)
    if pay == "CGHS" and p["age"] < 18:
        pay = "UPI"
    fu = random.random() < chronic * (0.8 if vtype != "Follow-up" else 0.45) or vtype == "IPD admission"
    fu_date = (date + timedelta(days=random.choice([7, 14, 15, 30, 30, 60, 90]))).strftime("%Y-%m-%d") if fu else ""

    row = {**p, "age_group": age_group(p["age"]), "department": dept, "issue": issue, "doctor_name": doctor,
           "visit_date": date.strftime("%Y-%m-%d"), "visit_time": f"{random.randint(8, 19):02d}:{random.choice(['00', '15', '30', '45'])}",
           "visit_type": vtype, "wait_time_min": wait, "length_of_stay_days": stay, "consultation_fee": fee,
           "test_charges": tests, "medicine_charges": meds, "procedure_charges": proc, "total_amount": total,
           "payment_mode": pay, "follow_up_needed": "Yes" if fu else "No", "follow_up_date": fu_date,
           "satisfaction_rating": "", "feedback": "", "sentiment": ""}

    if random.random() < 0.7:  # 70% leave feedback
        score = 3.95 - max(0, wait - 30) / 25 - (0.5 if total > 30000 else 0) + (0.3 if vtype == "Teleconsultation" else 0) \
                + (0.25 if doctors.index(doctor) == 0 else 0) + random.gauss(0, 0.95)
        rating = max(1, min(5, round(score)))
        pol = "pos" if rating >= 4 else "neu" if rating == 3 else "neg"
        if wait > 60 and pol != "pos" and random.random() < 0.6:
            topic = "wait"
        elif total > 20000 and pol == "neg" and random.random() < 0.4:
            topic = "billing"
        else:
            topic = wpick([("wait", 1.5), ("doctor", 3), ("staff", 2), ("billing", 1.5), ("clean", 1.2), ("lab", 1.3)])
        text = random.choice(T[topic][pol]).format(d=doctor) + random.choice(CLOSERS[pol])
        row.update(satisfaction_rating=rating, feedback=text, sentiment={"pos": "Positive", "neu": "Neutral", "neg": "Negative"}[pol])
    return row


def build(n):
    patients, rows = [], []
    while len(rows) < n:
        # ~20% of visits come from a returning patient
        if patients and random.random() < 0.2:
            p = random.choice(patients)
        else:
            p = make_patient(len(patients) + 1)
            patients.append(p)
        date = rand_date()
        row = make_visit(p, date, wpick(VISIT_TYPES))
        rows.append(row)
        # some patients come back for the scheduled follow-up
        if row["follow_up_date"] and len(rows) < n and random.random() < 0.45:
            fdate = datetime.strptime(row["follow_up_date"], "%Y-%m-%d")
            if fdate <= END:
                rows.append(make_visit(p, fdate, "Follow-up", row["department"], row["doctor_name"], row["issue"]))
    rows.sort(key=lambda r: (r["visit_date"], r["visit_time"]))
    for i, r in enumerate(rows, 1):
        r["visit_id"] = f"V-{i:05d}"
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--visits", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    random.seed(args.seed)
    rows = build(args.visits)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} visits, {len({r['patient_id'] for r in rows})} patients, "
          f"{sum(1 for r in rows if r['feedback'])} with feedback -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
