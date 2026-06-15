# EVAP System Smoke Testing

## Purpose and when to use

Smoke testing is the definitive way to locate EVAP leaks behind codes P0440, P0442, P0455, and P0456. Replace-the-gas-cap-and-pray works often enough to be tempting, but a smoke machine turns a comeback risk into a fifteen-minute find.

## Machine setup and safety

### Pressure limits

EVAP systems are low-pressure systems. Set the smoke machine regulator to 0.5-1.0 PSI maximum — more pressure can damage the fuel tank pressure sensor or pop hoses off and create the leak you're hunting. Use inert gas (nitrogen) or the machine's shop-air mode only if the manufacturer rates it for fuel vapor spaces.

### Access points

Best entry is the EVAP service port if equipped (GM trucks have one on the purge line, green cap). Otherwise, tee into the purge line at the engine side or smoke through the filler neck with a tank adapter.

## Test procedure

1. Vehicle cold or near-cold; a hot exhaust under the tank makes smoke hard to see and is a fire consideration.
2. Command the vent solenoid CLOSED with a bidirectional scan tool — otherwise smoke exits the vent and you'll chase a false "leak" at the canister. Leave the purge valve closed (its default state).
3. Introduce smoke and watch the machine's flow gauge. Flow that never tapers to near-zero confirms a leak is present.
4. Inspect in this order (highest hit rate first): gas cap seal, filler neck lip (rust), hose unions at the canister, purge valve seat, tank seam and sender O-ring.
5. Kill the shop lights and use a bright flashlight at low angle — small-leak wisps show in the beam that are invisible under fluorescents.
6. For 0.020-class leaks (P0456), be patient: pressurize for several minutes and re-inspect. Verify your machine against a calibrated 0.020 orifice if you're not finding it.

## Verifying the repair

After the fix, smoke again and confirm the flow gauge drops to baseline with the system sealed. Then clear codes and run the EVAP monitor with the scan tool's on-demand test, or confirm the monitor completes over a drive cycle. The monitor passing — not the smoke test alone — is what keeps the customer from coming back with the same light.
