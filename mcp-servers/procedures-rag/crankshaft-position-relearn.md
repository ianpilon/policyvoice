# Crankshaft Position Sensor Relearn (CASE Relearn)

## When a crank relearn is required

A crankshaft position variation relearn (GM calls it CASE relearn) is required after replacing the crankshaft position sensor, the PCM, the crankshaft, the flexplate or flywheel, or after any timing chain or front-cover work that disturbs the reluctor relationship. Symptoms of a missing relearn: P0315 (crankshaft position system variation not learned), false misfire codes at high RPM, or a misfire monitor that never completes.

## GM crankshaft relearn procedure (scan tool method)

### Preconditions

Engine at operating temperature (coolant above 70°C / 158°F), hood closed area clear, transmission in Park, A/C off, no other DTCs stored except P0315. A bidirectional scan tool with the CASE learn function is required — this cannot be done by drive cycle alone on most GM applications.

### Steps

1. Connect the scan tool and select Crankshaft Position Variation Learn.
2. Apply and hold the brake pedal firmly for the entire procedure.
3. Start the engine and follow the tool prompt to raise RPM. The tool commands the PCM into learn mode.
4. Slowly raise engine speed to the target (typically 3000-5150 RPM depending on engine) until the PCM cuts fuel — RPM will drop on its own. Release the throttle immediately when the cut happens.
5. The scan tool reports learn complete. Cycle the ignition off for 30 seconds.
6. Clear P0315 and verify the misfire monitor runs to completion on a road test.

### If the learn aborts

Common abort causes: coolant temp too low, a stored DTC blocking the learn, or releasing the brake mid-procedure. Fix the precondition and repeat. If the learn aborts repeatedly at the fuel-cut point, inspect the reluctor wheel for damage.

## Ford and Chrysler notes

### Ford

Most Fords self-learn the crank profile during deceleration fuel cut: drive at 40-60 mph, release the throttle, and let the vehicle coast in gear for 10+ seconds; repeat three to five times. No scan tool needed unless a P0315 persists.

### Chrysler / RAM

Use the scan tool Cam/Crank Relearn function. Same preconditions as GM. On 5.7L HEMI, a failed relearn that repeats usually means the tone wheel on the crank was damaged during rear-main-seal work.
