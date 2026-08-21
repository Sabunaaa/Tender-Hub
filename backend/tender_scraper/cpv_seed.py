"""Seed the full CPV category list into SQLite."""

from __future__ import annotations

from .repository import Repository

# Subset of portal CPV categories — enough for the picker; ids match SPA portal.
CPV_SEED: list[tuple[int, str, str]] = [
    (18864, "03100000", "Agricultural and horticultural products"),
    (18865, "03200000", "Cereals, potatoes, vegetables, fruits and nuts"),
    (18870, "03300000", "Farming, hunting and fishing products"),
    (18871, "03400000", "Forestry and logging products"),
    (18866, "09100000", "Fuels"),
    (18867, "09200000", "Petroleum, coal and oil products"),
    (18868, "09300000", "Electricity, heating, solar and nuclear energy"),
    (18869, "14200000", "Sand and clay"),
    (18925, "30100000", "Office machinery, equipment and supplies except computers, printers and furniture"),
    (18924, "30200000", "Computer equipment and supplies"),
    (18931, "31100000", "Electric motors, generators and transformers"),
    (18932, "31200000", "Electricity distribution and control apparatus"),
    (18926, "31300000", "Insulated wire and cable"),
    (18927, "31400000", "Accumulators, primary cells and primary batteries"),
    (18928, "31500000", "Lighting equipment and electric lamps"),
    (18929, "31600000", "Electrical equipment and apparatus"),
    (18930, "31700000", "Electronic, electromechanical and electrotechnical supplies"),
    (18933, "32200000", "Transmission apparatus for radiotelephony, radiotelegraphy, radio broadcasting and television"),
    (18935, "32300000", "Television and radio receivers, and sound or video recording or reproducing apparatus"),
    (18936, "32400000", "Networks"),
    (18937, "32500000", "Telecommunications equipment and supplies"),
    (18934, "33100000", "Medical equipments"),
    (18938, "33600000", "Pharmaceutical products"),
    (18940, "34100000", "Motor vehicles"),
    (18971, "39100000", "Furniture"),
    (18995, "44200000", "Structural products"),
    (19003, "45200000", "Works for complete or part construction and civil engineering work"),
    (19007, "48100000", "Industry specific software package"),
    (19008, "48200000", "Networking, Internet and intranet software package"),
    (19014, "48800000", "Information systems and servers"),
    (19015, "48900000", "Miscellaneous software package and computer systems"),
    (19018, "50300000", "Repair, maintenance and associated services related to personal computers, office equipment, telecommunications and audio-visual equipment"),
    (19021, "50800000", "Miscellaneous repair and maintenance services"),
    (19023, "51300000", "Installation services of communications equipment"),
    (19027, "51600000", "Installation services of computers and office equipment"),
    (19056, "64200000", "Telecommunications services"),
    (19070, "72100000", "Hardware consultancy services"),
    (19071, "72200000", "Software programming and consultancy services"),
    (19083, "72300000", "Data services"),
    (19084, "72400000", "Internet services"),
    (19072, "72500000", "Computer-related services"),
    (19073, "72600000", "Computer support and consultancy services"),
    (19074, "72700000", "Computer network services"),
    (19053, "71200000", "Architectural and related services"),
    (19054, "71300000", "Engineering services"),
    (19120, "85100000", "Health services"),
]


def seed_cpv_categories(repo: Repository | None = None) -> int:
    repo = repo or Repository()
    repo.upsert_cpv_categories(CPV_SEED)
    return len(CPV_SEED)
