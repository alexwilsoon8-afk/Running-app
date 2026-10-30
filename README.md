# Treadmill C25K

Couch to 5K interval coach for one shared treadmill, with live heart rate from a Garmin or chest strap. Plain HTML, CSS and JavaScript: no build step, no backend. All data stays on the tablet.

## Put it online

Web Bluetooth only works over HTTPS, so the app needs hosting. Free option, GitHub Pages:

1. Create a public repository on github.com. This one is `Running-app`.
2. Use **Add file > Upload files** and drag in everything in this folder.
3. Go to **Settings > Pages**, set the source to the `main` branch, `/ (root)`, and save.
4. After a minute the app is at `https://alexwilsoon8-afk.github.io/Running-app/`.

## Set up the tablet

1. Open that address in Chrome on the Galaxy Tab A9+.
2. Chrome menu > **Add to Home screen**, then open the app from the home screen icon.
3. Allow Nearby devices when Chrome asks. Keep Bluetooth on, and Location too if the watch doesn't appear in the list.
4. Tap **Add runner** and enter a name for each person. Tick **Uses a heart rate sensor** for anyone wearing one.
5. For those people, enter the max HR from the watch or Garmin Connect and tap **Calculate zones**. This uses Garmin's default zones, so it matches the watch unless the zones were customised; if they were, type all five in. The watch's broadcast only sends bpm, so update the max HR here if it changes on Garmin. If a run holds a heart rate above the saved max for about 5 seconds, the finish screen offers to update it. Set an HR ceiling if you want one.
6. With the box unticked, Settings offers evidence-based zones from resting HR and age instead. There's no live HR without a sensor, so these are for reference and the run screen colours follow RUN/WALK.

## Test heart rate first

On the watch, start a Treadmill activity and turn on Broadcast HR (Settings > Sensors and Accessories > Wrist Heart Rate > Broadcast; wording varies by firmware). Then use **Test heart rate** in your runner's Settings. A live bpm reading means it's working.

## Each run

Start the watch activity and Broadcast HR, pick a runner, connect, and tap **Start run**. The watch still records the run to Garmin Connect. Connecting is never required: the run works without HR.

## Changing things

- The plan is in `plan.json`. It follows the [NHS Couch to 5K plan](https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/).
- To test the logic, serve this folder over HTTP and open `tests/index.html`.
- After uploading changes, open the app online once. The tablet picks up the new version the next time it opens.
