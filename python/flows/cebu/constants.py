"""Cebu site URLs, browser headers, and availability sample payload."""

SITE = "https://www.cebupacificair.com"
SELECT_FLIGHT = f"{SITE}/en-PH/booking/select-flight"
SEARCH_URL = "https://soar.cebupacificair.com/ceb-omnix-proxy-v3/availability"

PROFILE = "android-chrome/2201116sg-v138-10025"

UA = (
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36"
)
SEC_CH_UA = '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"'
ACCEPT_LANG = "dz-BT,dz;q=0.9,en;q=0.8"
DOC_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
    "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
)
SEARCH_ACCEPT = "application/json, text/plain, */*"

# Captured Web v3 availability sample. Session cookies (_abck/bm_s) from init.
# HTTP 401 = bot passed + stale/invalid anonymous auth.
AUTHORIZATION = "Bearer ff020ca4a2a0MoV5doJAgndROj90LA3trQleGE"
X_AUTH_TOKEN = (
    "837bd9b7a6U2FsdGVkX1+v2jUFaYmhWijDL3pyl5Fa0cAtWT4qTfyTcDmYs3UktAk/6Xip/co7"
    "QmhmOZscQ/n9FmOGKotA1WSFd6Uo1Hbyr+4TyDl3d26NnQ7HP/n7UtMV/PQBCuFGbgv192DfK+L"
    "xsiIQRDmcnInOzkUvFRFmG9BHwpyUYE8131ZItFKgqHcgHIT2oeKR5JZ3urZGfX4QQQpH7O0Tt9"
    "QJuvWsI6yY7AyEG2/pVYFgW4D8BVLLW0+7Mryt8p7JUGOEqdX7wIf24xU9rXxh/VjWTbzOBFKPV"
    "GSJfVU4HGg="
)
X_PATH = "U2FsdGVkX19lEh6mUmJtjvofU5TNrKriSc6QSUKLV3c="
DEFAULT_BODY = (
    '{"content":"U2FsdGVkX1++rgeTvC4KykMJNXMS9no1//kQGagNJcFIBev2I3hvbq9PYpRS3P0rheYk'
    "pM29yAljeQkee4+GW26MTrimeyjvmZ5cParoSzDOWoLEFGdLkqqH0OOVTx8CgN9xmIfXmuGva4E5"
    "u0AprbAQn+y53Slw3HoN4+r3pSoruQ55c27Fhd+5S1r755eAlHmixHDOoZnlFYlil2uCMi8Hogre"
    "woYw53VBdMNRv0mjQg+3Quvmmpoukqd+a2owfVmXv1x32Gc39VfQg7599qBfW4IB0VlTZjmt00ZN"
    "o6arsAcPVe2c+f52IrWtVyAcOxBzEYwlD9L48vKFNa91IdWtQ837bd9b7a6U2FsdGVkX1+v2jUFa"
    "YmhWijDL3pyl5Fa0cAtWT4qTfyTcDmYs3UktAk/6Xip/co7QmhmOZscQ/n9FmOGKotA1WSFd6Uo1"
    "Hbyr+4TyDl3d26NnQ7HP/n7UtMV/PQBCuFGbgv192DfK+LxsiIQRDmcnInOzkUvFRFmG9BHwpyUY"
    "E8131ZItFKgqHcgHIT2oeKR5JZ3urZGfX4QQQpH7O0Tt9QJuvWsI6yY7AyEG2/pVYFgW4D8BVLLW"
    "0+7Mryt8p7JUGOEqdX7wIf24xU9rXxh/VjWTbzOBFKPVGSJfVU4HGg=00bl1Uu+EOl6trV9nAcSt"
    "tyCdCzJB/8UCj08cg5r95tPNKliv9hJy1u+tSxBpbTHBPWoCCEB1LSIr2fexlzMZDHjUD3wCUEP5"
    "7HSoxqBs+M0yTCTeKiZUPMJFxNGKff020ca4a2a0MoV5doJAgndROj90LA3trQleGEMtLONGsOTo"
    "HbcI3p6LXJLelHon55uDE0fgHNe2NtohsHawwRsHJ66rWfGaMbAapGPJTw/VvGefYB7ON6EnENwL"
    "ZtR/36t/FpsC0dWx050fa2ZPsTNIhYCeUh+ul0Xk8/zKIfePfbWLENpKsSurlUGXbj1FaCc8doXt"
    'iqK/EVEO"}'
)

# Availability request wire order from browser capture (HTTP/1.x).
SEARCH_HEADER_ORDER = [
    "host",
    "content-length",
    "user-agent",
    "accept",
    "accept-encoding",
    "content-type",
    "sec-ch-ua-platform",
    "x-auth-token",
    "authorization",
    "x-path",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "origin",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    "referer",
    "accept-language",
    "priority",
    "cookie",
]

SEARCH_COOKIE_NAMES = frozenset({"_abck", "bm_s"})
