"""LinkedIn / Indeed / Glassdoor / Bdjobs / Bayt job listings via JobSpy (public search pages, no login).
stdin:  {"terms": [...], "targets": [{"location": "Dhaka, Bangladesh"}, {"location": "UAE"}],
         "distance_miles": 31, "hours_old": 168, "results": 15}
stdout: {"jobs": [...normalized...], "errors": {"site (location)": "message"}}
Run with --selftest to check the site/country rules.
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor

ALIASES = {"uae": "united arab emirates", "united kingdom": "uk", "england": "uk", "ksa": "saudi arabia",
           "united states": "usa", "us": "usa", "korea": "south korea"}
GULF_MENA = {"united arab emirates", "saudi arabia", "qatar", "kuwait", "bahrain", "oman", "egypt", "jordan", "lebanon", "morocco"}


def indeed_country(name, countries):
    """JobSpy's Indeed/Glassdoor country value for a place's country, or None if unsupported."""
    n = ALIASES.get(name.lower().strip(), name.lower().strip())
    return n if n in countries else None


def sites_for(location, countries):
    """Which sites to search for a location, and the Indeed country to use."""
    if not location:
        return ["linkedin", "indeed", "glassdoor"], "usa"
    name = location.split(",")[-1].strip().lower()
    country = indeed_country(name, countries)
    sites = ["linkedin"] + (["indeed", "glassdoor"] if country else [])
    if ALIASES.get(name, name) == "bangladesh":
        sites.append("bdjobs")
    if ALIASES.get(name, name) in GULF_MENA:
        sites.append("bayt")
    return sites, country or "usa"


def val(v):
    return None if v is None or v != v else v  # NaN != NaN


def emails(v):
    """JobSpy gives a list or a comma-joined string."""
    v = val(v)
    items = v.split(",") if isinstance(v, str) else (v or [])
    return [e.strip() for e in items if e and "@" in e][:10]


def site_jobs(scrape_jobs, site, plan, args):
    """One site, its targets in sequence (parallel requests to one site trigger rate limits)."""
    out, errors = [], {}
    for location, country in plan:
        try:
            for term in args["terms"]:
                df = scrape_jobs(site_name=[site], search_term=term, location=location or None,
                                 distance=args.get("distance_miles", 50), country_indeed=country,
                                 results_wanted=args.get("results", 15), hours_old=args.get("hours_old", 168),
                                 fetch_description=True, description_format="plain", verbose=0)
                for r in df.to_dict("records"):
                    out.append({
                        "id": f"jobspy:{site}:{r.get('id') or r.get('job_url')}",
                        "source": site.replace("_", " ").title(),
                        "title": val(r.get("title")),
                        "company": val(r.get("company")),
                        "location": val(r.get("location")),
                        "remote": 1 if val(r.get("is_remote")) else 0,
                        "url": val(r.get("job_url")),
                        "description": val(r.get("description")) or "",
                        "posted_at": str(val(r.get("date_posted")) or ""),
                        "emails": emails(r.get("emails")),
                        "company_url": val(r.get("company_url_direct")),  # not the board's company page
                    })
        except Exception as e:
            errors[f"{site} ({location or 'any'})"] = str(e)[:200]
    return out, errors


def main():
    from jobspy import scrape_jobs
    from jobspy.model import Country
    countries = {c.value for c in Country}
    args = json.load(sys.stdin)
    plans = {}
    for t in args["targets"]:
        sites, country = sites_for(t.get("location", ""), countries)
        for s in sites:
            plans.setdefault(s, []).append((t.get("location", ""), country))
    jobs, errors = [], {}
    with ThreadPoolExecutor(len(plans)) as ex:
        for o, e in ex.map(lambda s: site_jobs(scrape_jobs, s, plans[s], args), plans):
            jobs += o
            errors.update(e)
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump({"jobs": jobs, "errors": errors}, sys.stdout)


def selftest():
    countries = {"uk", "united arab emirates", "saudi arabia", "singapore", "usa"}
    assert sites_for("Dhaka, Bangladesh", countries) == (["linkedin", "bdjobs"], "usa")
    assert sites_for("UAE", countries) == (["linkedin", "indeed", "glassdoor", "bayt"], "united arab emirates")
    assert sites_for("London, United Kingdom", countries) == (["linkedin", "indeed", "glassdoor"], "uk")
    assert sites_for("Qatar", countries) == (["linkedin", "bayt"], "usa")
    assert sites_for("", countries)[0] == ["linkedin", "indeed", "glassdoor"]
    assert emails("a@x.com, b@y.org") == ["a@x.com", "b@y.org"] and emails(float("nan")) == [] and emails(["c@z.io"]) == ["c@z.io"]
    print("selftest ok")


if __name__ == "__main__":
    selftest() if "--selftest" in sys.argv else main()
