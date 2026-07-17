# Python mimic flow runtime

Site-agnostic helpers for driving **mimic** sensor capture over **rnet**, plus
site scripts under `flows/`.

## Layout

```
python/
  mimic_flow/          # framework
    proxy/             # lumi | none | reqable | mitm
    session/           # rnet client, http, cookies
    mimic/             # node bridge capture
    runtime/           # FlowContext, workers, CLI flags
  flows/
    cebu/              # Cebu Pacific business flow only
```

## Run Cebu

From repo root (thin wrapper, recommended):

```bash
python3 test/cebu_flow.py --search
python3 test/cebu_flow.py --search --proxy lumi --country gb -j 5
python3 test/cebu_flow.py --search --proxy none          # direct / local baseline
python3 test/cebu_flow.py --search --proxy mitm
python3 test/cebu_flow.py --search --proxy reqable
```

Or as a module:

```bash
PYTHONPATH=python python3 -m flows.cebu --search --proxy lumi
```

## Proxy env (optional overrides)

| Variable | Default role |
|----------|----------------|
| `LUMI_PROXY_URL` | Bright Data superproxy URL |
| `LUMI_CUSTOMER_ZONE` | username prefix |
| `LUMI_PASSWORD` | zone password |
| `LUMI_COUNTRY` | fixed exit country (`gb`) |
| `REQABLE_PROXY` | local Reqable |
| `MITM_PROXY` | MITM CONNECT URL |
| `MITM_CLIENTHELLO_ID` | CONNECT header value |
| `MIMIC_CAPTURE_BRIDGE` | path to `cebu_capture.mjs` |
| `MIMIC_PROFILE` | mimic profile id |

## Adding another site

1. Create `flows/<site>/` with `constants.py`, `flow.py`, `__main__.py`.
2. Implement `async def run_flow(ctx: FlowContext, **kwargs) -> dict` using
   `ctx.get` / `ctx.post` / `ctx.capture` / `ctx.cookies`.
3. Wire CLI like `flows/cebu/__main__.py` (`make_proxy_provider` + `run_concurrent`).
