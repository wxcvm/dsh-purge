# CISA Known Exploited Vulnerabilities (KEV) catalog

Purge includes a pinned offline snapshot of the CISA KEV catalog.

- Snapshot version: `2026.11.25`
- Released: `2026-11-25T19:48:12.4344Z`
- Records: 1,805 distinct CVE IDs
- Canonical catalog: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- JSON feed: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
- CISA-maintained GitHub mirror: https://github.com/cisagov/kev-data
- Mirror snapshot commit: `51e0a777743fa06957afbaeb280f8735d292c1be`
- License: CC0 1.0; third-party links inside individual records remain subject to their own terms.

## Interpretation rules

- KEV means CISA lists the CVE as known exploited in the wild. It is a prioritization signal, not a complete list of all vulnerabilities.
- `dateAdded` is when CISA added the record, not the first exploitation date.
- `dueDate` reflects CISA/BOD remediation deadlines for covered federal agencies; it is not a universal deadline for every organization.
- `knownRansomwareCampaignUse: Unknown` is unknown, not a negative finding.
- KEV does not provide affected-version boundaries. These rows intentionally have no `version_constraints`; applicability remains `unknown` until a vendor advisory or other authoritative version source is attached.
- `verified=false` means Purge has not independently verified a local PoC. Do not convert KEV membership into a claim that a particular asset/version is vulnerable.

The normalized rows retain vendor, product, vulnerability name, description, required action, date added, due date, ransomware-use flag, forensic-triage flag, CWEs, notes, catalog version and source provenance.

## Refresh the snapshot

Download the official JSON feed and run the offline importer:

```sh
node scripts/import-cisa-kev.mjs ./known_exploited_vulnerabilities.json
```

If the snapshot was downloaded from the CISA-maintained GitHub mirror, optionally preserve its exact commit:
```sh
CISA_KEV_MIRROR_COMMIT=<40-hex-commit> node scripts/import-cisa-kev.mjs ./known_exploited_vulnerabilities.json
```

The importer performs no network requests. It validates the feed count, CVE syntax and uniqueness before writing `lib/redteam/cve-catalog/cisa-kev.json`. Review the catalog version/date and rerun the CVE tests before committing a refresh.
