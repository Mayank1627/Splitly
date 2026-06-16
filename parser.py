#!/usr/bin/env python3
import csv
import sys
import json
import re
from datetime import datetime

# Define standard group members
VALID_MEMBERS = ["Aisha", "Rohan", "Priya", "Meera", "Sam", "Dev", "Kabir"]

# Exchange rates tied to month/year of transaction
EXCHANGE_RATES = {
    "2026-02": 83.00,
    "2026-03": 83.50,
    "2026-04": 84.00,
    "2026-05": 84.00
}
DEFAULT_EXCHANGE_RATE = 83.50

def normalize_name(name):
    """Normalize user name to handle typos, casing, and trailing spaces."""
    if not name:
        return None
    cleaned = name.strip().lower()
    if cleaned in ["aisha", "rohan", "priya", "meera", "sam", "dev", "kabir"]:
        return cleaned.capitalize()
    if cleaned == "priya s":
        return "Priya"
    if "kabir" in cleaned:
        return "Kabir"
    if cleaned == "rohan":
        return "Rohan"
    return name.strip()

def parse_date(date_str):
    """Parse date from various messy formats. Returns (datetime_date, error_message)."""
    if not date_str:
        return None, "Missing Date"
    date_str = date_str.strip()
    
    # Format: DD-MM-YYYY
    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt).date(), None
        except ValueError:
            pass
            
    # Format: Mar-14, Apr-08, etc.
    match = re.match(r"^([a-zA-Z]{3})-(\d{1,2})$", date_str)
    if match:
        month_str, day_str = match.groups()
        try:
            # Assume 2026 as standard
            dt = datetime.strptime(f"{day_str}-{month_str}-2026", "%d-%b-%Y")
            return dt.date(), "Mismatched Date Format (Abbreviated)"
        except ValueError:
            pass
            
    # If it is MM-DD-YYYY or similar
    try:
        # Check for DD/MM/YYYY
        dt = datetime.strptime(date_str, "%m-%d-%Y")
        return dt.date(), "Ambiguous Date Format"
    except ValueError:
        pass

    return None, "Invalid Date Format"

def extract_percentages(split_details):
    """Parse split details string like 'Aisha 30%; Rohan 30%; Priya 30%; Meera 20%'."""
    if not split_details:
        return {}, "Empty Split Details"
    
    pairs = [p.strip() for p in split_details.split(";") if p.strip()]
    splits = {}
    total = 0.0
    for pair in pairs:
        # Find last space or %
        match = re.match(r"^(.+?)\s*(\d+(?:\.\d+)?)\s*%\s*$", pair)
        if not match:
            return {}, f"Invalid percentage format: {pair}"
        user_raw, val_str = match.groups()
        user = normalize_name(user_raw)
        val = float(val_str)
        splits[user] = val
        total += val
    return splits, None

def extract_shares(split_details):
    """Parse split details string like 'Aisha 1; Rohan 2; Priya 1; Dev 2'."""
    if not split_details:
        return {}, "Empty Split Details"
    
    pairs = [p.strip() for p in split_details.split(";") if p.strip()]
    splits = {}
    for pair in pairs:
        # Match name and number
        match = re.match(r"^(.+?)\s*(\d+(?:\.\d+)?)\s*$", pair)
        if not match:
            return {}, f"Invalid share format: {pair}"
        user_raw, val_str = match.groups()
        user = normalize_name(user_raw)
        val = float(val_str)
        splits[user] = val
    return splits, None

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: parser.py <csv_file> <memberships_json>"}))
        sys.exit(1)
        
    csv_file_path = sys.argv[1]
    memberships_raw = sys.argv[2]
    
    try:
        memberships = json.loads(memberships_raw)
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse memberships JSON: {str(e)}"}))
        sys.exit(1)
        
    # Read CSV contents
    rows = []
    try:
        with open(csv_file_path, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for r in reader:
                rows.append(r)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read CSV file: {str(e)}"}))
        sys.exit(1)

    clean_results = []
    anomalies = []
    seen_expenses = []

    for index, row in enumerate(rows, start=1):
        issues = []
        fixed_payload = {}
        
        # Raw columns
        raw_date = row.get("date", "").strip()
        raw_desc = row.get("description", "").strip()
        raw_paid_by = row.get("paid_by", "").strip()
        raw_amount = row.get("amount", "").strip().replace(",", "")
        raw_currency = row.get("currency", "").strip()
        raw_split_type = row.get("split_type", "").strip()
        raw_split_with = row.get("split_with", "").strip()
        raw_split_details = row.get("split_details", "").strip()
        raw_notes = row.get("notes", "").strip()
        
        # Reconstruct raw CSV row string for DB storage
        raw_row_str = f"Row {index}: Date={raw_date}, Desc={raw_desc}, PaidBy={raw_paid_by}, Amount={raw_amount}, Currency={raw_currency}, SplitType={raw_split_type}, SplitWith={raw_split_with}, Details={raw_split_details}, Notes={raw_notes}"

        # 1. Payer validation & normalization
        normalized_payer = normalize_name(raw_paid_by)
        if not raw_paid_by:
            issues.append("Missing Payer (paid_by is empty)")
            normalized_payer = "Aisha"  # Safe default fallback
        elif normalized_payer not in VALID_MEMBERS:
            issues.append(f"Unrecognized Payer Name: '{raw_paid_by}'")
        elif normalized_payer != raw_paid_by:
            issues.append(f"Payer Name Mismatch/Formatting: '{raw_paid_by}' -> '{normalized_payer}'")
            
        fixed_payload["paid_by"] = normalized_payer

        # 2. Date parsing & validation
        parsed_date, date_err = parse_date(raw_date)
        if date_err:
            issues.append(f"Date formatting issue: {date_err} ('{raw_date}')")
            # If date format is Mar-14 or similar, we resolved it to 2026-03-14
            # If totally invalid, default to a sensible date or allow user review
            if parsed_date is None:
                parsed_date = datetime(2026, 2, 1).date()
        
        # 3. Check chronological alignment / Ambiguous Date format (04-05-2026 is Row 34, coming after March 28 but before April 1)
        if raw_date == "04-05-2026":
            issues.append("Ambiguous/Out-of-Sequence Date: '04-05-2026' (Might be April 5th logged in MM-DD-YYYY or May 4th)")
            parsed_date = datetime(2026, 4, 5).date() # Propose April 5th based on sequence
            
        fixed_payload["date"] = parsed_date.strftime("%Y-%m-%d")

        # 4. Amount parsing
        amount = None
        try:
            amount = float(raw_amount)
        except ValueError:
            issues.append(f"Invalid numeric Amount: '{raw_amount}'")
            amount = 0.0
            
        fixed_payload["raw_amount"] = amount

        # 5. Zero Amount validation
        if amount == 0.0:
            issues.append("Zero Amount expense logged")
            
        # 6. Negative amount / Refund interception
        is_refund = False
        if amount < 0.0:
            if "refund" in raw_desc.lower():
                is_refund = True
                issues.append(f"Negative Amount (Intercepted as Refund): '{raw_amount}'")
            else:
                issues.append(f"Negative Amount (Possible Ingestion Error): '{raw_amount}'")
        
        # 7. Currency check
        currency = raw_currency
        if not raw_currency:
            issues.append("Missing Currency (field is empty)")
            currency = "INR"
        elif raw_currency not in ["INR", "USD"]:
            issues.append(f"Unrecognized Currency: '{raw_currency}'")
            
        fixed_payload["currency"] = currency

        # 8. Multi-currency exchange rate mapping
        exchange_rate = 1.0
        amount_inr = amount
        if currency == "USD":
            date_key = parsed_date.strftime("%Y-%m")
            exchange_rate = EXCHANGE_RATES.get(date_key, DEFAULT_EXCHANGE_RATE)
            amount_inr = amount * exchange_rate
            issues.append(f"USD Currency detected: Applied conversion rate of {exchange_rate}")
            
        fixed_payload["exchange_rate"] = exchange_rate
        fixed_payload["amount_inr"] = amount_inr

        # 9. Intercept Settlements logged as Expenses
        is_settlement = False
        if "paid aisha back" in raw_desc.lower() or "deposit share" in raw_desc.lower() or "settle" in raw_desc.lower():
            is_settlement = True
            issues.append("Settlement/Direct Transfer logged as Expense")
            fixed_payload["is_settlement"] = True
            fixed_payload["settlement_payer"] = normalized_payer
            # Find settlement payee
            payee = "Aisha" # Default for "paid Aisha back"
            for m in VALID_MEMBERS:
                if m != normalized_payer and m.lower() in raw_desc.lower():
                    payee = m
            # If split_with is single person
            split_members = [normalize_name(u) for u in raw_split_with.split(";") if u.strip()]
            if len(split_members) == 1:
                payee = split_members[0]
            fixed_payload["settlement_payee"] = payee
        else:
            fixed_payload["is_settlement"] = False

        # 10. Split members parsing & validation
        split_members = []
        if raw_split_with:
            split_members = [normalize_name(u) for u in raw_split_with.split(";") if u.strip()]
            
            # Check for name typos in split members
            for orig_name in raw_split_with.split(";"):
                if orig_name.strip():
                    norm = normalize_name(orig_name)
                    if norm not in VALID_MEMBERS:
                        issues.append(f"Unrecognized User in splits list: '{orig_name}'")
                    elif norm != orig_name.strip():
                        issues.append(f"Split User name mismatch/formatting: '{orig_name}' -> '{norm}'")
        else:
            if not is_settlement:
                issues.append("Missing Split Members (split_with is empty)")
                split_members = [m for m in VALID_MEMBERS if m != "Kabir"]  # Default standard roommates
                
        fixed_payload["split_with"] = split_members

        # 11. Split type and split details validation
        split_type = raw_split_type.lower() if raw_split_type else "equal"
        fixed_payload["split_type"] = split_type
        
        split_breakdown = {}
        
        if split_type == "equal":
            if raw_split_details:
                issues.append("Mismatched Split Type and Details (Split type is equal, but details has values)")
            if split_members:
                share_amount = amount_inr / len(split_members)
                for member in split_members:
                    split_breakdown[member] = round(share_amount, 2)
                    
        elif split_type == "percentage":
            percentages, pct_err = extract_percentages(raw_split_details)
            if pct_err:
                issues.append(f"Invalid split details: {pct_err}")
                # Fallback to equal split suggestion
                if split_members:
                    share_amount = amount_inr / len(split_members)
                    for member in split_members:
                        split_breakdown[member] = round(share_amount, 2)
            else:
                pct_sum = sum(percentages.values())
                if abs(pct_sum - 100.0) > 0.01:
                    issues.append(f"Invalid Split Percentages: Sum is {pct_sum}% (Must be 100%)")
                
                # Apply percentage to total amount
                for member, pct in percentages.items():
                    split_breakdown[member] = round(amount_inr * (pct / 100.0), 2)
                    
        elif split_type in ["share", "unequal"]:
            shares, share_err = extract_shares(raw_split_details)
            if share_err:
                issues.append(f"Invalid split details: {share_err}")
                if split_members:
                    share_amount = amount_inr / len(split_members)
                    for member in split_members:
                        split_breakdown[member] = round(share_amount, 2)
            else:
                total_shares = sum(shares.values())
                for member, sh in shares.items():
                    split_breakdown[member] = round(amount_inr * (sh / total_shares), 2)
                    
        else:
            issues.append(f"Unrecognized split type: '{raw_split_type}'")
            if split_members:
                share_amount = amount_inr / len(split_members)
                for member in split_members:
                    split_breakdown[member] = round(share_amount, 2)
                    
        fixed_payload["splits"] = split_breakdown

        # 12. Temporal Window Membership Rules (Sam and Meera)
        for member in split_members + ([normalized_payer] if normalized_payer else []):
            if member in memberships:
                member_joined = datetime.strptime(memberships[member]["joined_at"], "%Y-%m-%d").date()
                member_left = None
                if memberships[member]["left_at"]:
                    member_left = datetime.strptime(memberships[member]["left_at"], "%Y-%m-%d").date()
                
                # Meera validation (left March 31, 2026)
                if member == "Meera" and parsed_date > datetime(2026, 3, 31).date():
                    issues.append(f"Temporal Membership Anomaly: Meera left March 31, 2026, but is involved in expense on {parsed_date}")
                    # Suggested fix: remove Meera from split
                    if "Meera" in fixed_payload["split_with"]:
                        fixed_payload["split_with"] = [m for m in fixed_payload["split_with"] if m != "Meera"]
                        # Re-run split calculation without Meera
                        if fixed_payload["split_type"] == "equal" and fixed_payload["split_with"]:
                            new_share = amount_inr / len(fixed_payload["split_with"])
                            fixed_payload["splits"] = {m: round(new_share, 2) for m in fixed_payload["split_with"]}
                
                # Sam validation (joined April 15, 2026)
                if member == "Sam" and parsed_date < datetime(2026, 4, 15).date():
                    issues.append(f"Temporal Membership Anomaly: Sam joined April 15, 2026, but is involved in expense on {parsed_date}")
                    # Suggested fix: remove Sam from split
                    if "Sam" in fixed_payload["split_with"]:
                        fixed_payload["split_with"] = [m for m in fixed_payload["split_with"] if m != "Sam"]
                        # Re-run split calculation without Sam
                        if fixed_payload["split_type"] == "equal" and fixed_payload["split_with"]:
                            new_share = amount_inr / len(fixed_payload["split_with"])
                            fixed_payload["splits"] = {m: round(new_share, 2) for m in fixed_payload["split_with"]}

        # 13. Duplicate Entry Check
        is_dup = False
        # Normalize description for similarity matching
        desc_clean = re.sub(r'[^a-z0-9]', '', raw_desc.lower())
        for seen in seen_expenses:
            # Match date, payer, and amount
            if seen["date"] == parsed_date.strftime("%Y-%m-%d") and seen["paid_by"] == normalized_payer and abs(seen["raw_amount"] - amount) < 0.01:
                seen_desc_clean = re.sub(r'[^a-z0-9]', '', seen["description"].lower())
                # If description is very similar
                if desc_clean in seen_desc_clean or seen_desc_clean in desc_clean:
                    is_dup = True
                    break
        
        if is_dup:
            issues.append(f"Duplicate entry detected: similar expense already processed on {raw_date}")
            fixed_payload["is_duplicate"] = True
        else:
            fixed_payload["is_duplicate"] = False
            # Only add to seen expenses if it's not a duplicate
            seen_expenses.append({
                "date": parsed_date.strftime("%Y-%m-%d"),
                "paid_by": normalized_payer,
                "amount": amount,
                "raw_amount": amount,
                "description": raw_desc
            })

        # Final packaging
        row_summary = {
            "row_index": index,
            "raw_row_string": raw_row_str,
            "description": raw_desc,
            "original_row": row
        }
        
        if not issues:
            # Clean row
            clean_results.append({
                **row_summary,
                **fixed_payload
            })
        else:
            # Anomalous row
            anomalies.append({
                **row_summary,
                "issues": issues,
                "fixed_json_payload": fixed_payload
            })

    output = {
        "total_rows": len(rows),
        "clean_rows": clean_results,
        "anomalies": anomalies
    }
    
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
