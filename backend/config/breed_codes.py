"""
Breed Code Mapping Configuration
Maps breed types to standardized short codes for unique ID generation
"""

BREED_CODES = {
    "holstein": "HF",
    "jersey": "JR",
    "guernsey": "GY",
    "ayrshire": "AY",
    "brown_swiss": "BS",
    "gir": "GIR",
    "sahiwal": "SH",
    "red_sindhi": "RS",
    "tharparkar": "TP",
    "rathi": "RT",
    "kankrej": "KK",
    "ongole": "ON",
    "hariana": "HA",
    "hallikar": "HL",
    "khillar": "KH",
    "deoni": "DE",
    "krishna_valley": "KV",
    "amritmahal": "AM",
    "nagori": "NG",
    "dangi": "DG",
    "malnad_gidda": "MG",
    "vechur": "VC",
    "punganur": "PG",
    "ladakhi": "LD",
    "meo": "ME",
    "nimari": "NM",
    "kangayam": "KY",
    "umbalachery": "UM",
    "pulikulam": "PK",
    "bargur": "BR",
    "alambadi": "AL",
    "kasargod_dwarf": "KD",
    "kenkatha": "KN",
    "gaolao": "GL",
    "local": "LC",
    "mixed": "MX"
}

# Reverse mapping for lookup by code
CODE_TO_BREED = {v: k for k, v in BREED_CODES.items()}

# Default code for unknown breeds
DEFAULT_BREED_CODE = "UNK"


def get_breed_code(breed):
    """
    Get standardized breed code for a given breed.
    
    Args:
        breed (str): Breed name or BreedType enum
    
    Returns:
        str: Breed code (e.g., 'HF', 'JR', 'UNK')
    """
    if hasattr(breed, 'value'):  # Handle enum
        breed = breed.value
    
    breed_lower = breed.lower().replace(' ', '_')
    return BREED_CODES.get(breed_lower, DEFAULT_BREED_CODE)


def get_breed_name_from_code(code):
    """
    Get breed name from code.
    
    Args:
        code (str): Breed code
    
    Returns:
        str: Breed name or None if not found
    """
    return CODE_TO_BREED.get(code.upper())
