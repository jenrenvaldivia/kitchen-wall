# Kitchen wall screen

A quiet wall calendar for the Seeed reTerminal E1004 (13.3" color e-ink), hung tall. It shows:

- **Home**, the default page: a family photo across the top half (a different one each day), the date and weather, the one thing that matters next ("Trash out", "Start dinner · 4:15p", "Thaw for tomorrow") with today's meals and tonight's task, and three rolling weeks of calendar.
- **Today's meals**: breakfast and dinner steps, Rafa's plate, and the before-bed thaw.

The front buttons switch pages; refresh redraws now. Today's meals goes back to Home after an hour.

## How it works

```
Google Calendar ("Wall")  ─┐
menu.json (weekly menu)   ─┼─>  GitHub Actions, every 30 min  ─>  "display" branch  ─>  screen downloads its page
Google Drive photo folder ─┘     (render/ draws the pages)          (home.bin, meals.bin)    and goes back to sleep
```

The screen never draws anything itself. A GitHub Action draws each page every half hour, from about 5am to 10pm, and saves it in the exact format the panel needs. The screen wakes up, asks whether its page changed, downloads it only if it did, and sleeps again. Overnight it doesn't wake at all.

`home.png` and `meals.png` in the `display` branch show exactly what the wall shows right now, which is handy for checking from your phone.

---

## Setup

You only do this once. Steps 1–3 can be done before the screen arrives.

### 1. Make the Wall calendar

1. In Google Calendar on a computer, click **+** next to "Other calendars", then **Create new calendar**. Name it **Wall**.
2. Share it with Martin if he'll add things (**Settings and sharing → Share with specific people**).
3. Add what belongs on the kitchen wall. Put trash and recycling days in as all-day events named **Trash** and **Recycling**, set to repeat. Anything with "trash", "recycling" or "filter" in the name is treated as a morning chore.
4. In **Settings and sharing** for the Wall calendar, scroll to **Integrate calendar** and copy the **Secret address in iCal format**. Treat it like a password.

### 2. Add the calendar address to GitHub

In this repository on GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|---|---|
| `WALL_CALENDAR_ICS` | the secret iCal address from step 1 |

Then open the **Actions** tab, pick **Draw the wall screen**, and click **Run workflow**. After about a minute, switch to the `display` branch and open `home.png` to see your wall.

### 3. Photos (optional, can be done later)

Without this, the screen uses any JPG or PNG in the `photos/` folder of this repository.

Wide photos crop best: the photo area is 3:2, the shape of most camera photos held sideways. Bold, clear colors come out better than soft pastels.

To use a Google Drive folder instead, so you can add photos from your phone:

1. Make a folder in Google Drive called **Wall photos**. Open it and copy the long ID from the address bar (the part after `/folders/`).
2. Go to <https://console.cloud.google.com>, create a project called "Kitchen wall", and enable the **Google Drive API** for it.
3. Under **IAM & Admin → Service accounts**, create a service account. Open it, go to **Keys → Add key → JSON**, and download the file.
4. Back in Drive, share the **Wall photos** folder with the service account's email address (it ends in `iam.gserviceaccount.com`), as a Viewer.
5. Add two more repository secrets: `WALL_PHOTOS_FOLDER_ID` (the folder ID) and `GOOGLE_SERVICE_ACCOUNT_JSON` (the entire contents of the downloaded JSON file).

A different photo is shown each day. iPhone HEIC photos work.

### 4. Make a token for the screen

The screen needs read-only access to this private repository.

1. On GitHub: your picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it "Kitchen wall screen" and set an expiration (the longest is a year; put a reminder on the Wall calendar to renew it).
3. **Repository access → Only select repositories →** `kitchen-wall`.
4. **Permissions → Repository permissions → Contents → Read-only**. Nothing else.
5. Generate it and copy it.

### 5. Program the screen

1. Install the [Arduino IDE](https://www.arduino.cc/en/software).
2. **File → Preferences → Additional boards manager URLs**, add
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`.
   Then **Tools → Board → Boards Manager**, search "esp32" and install **esp32 by Espressif Systems**.
3. Download the Seeed_GFX library as a ZIP from <https://github.com/Seeed-Studio/Seeed_GFX> (**Code → Download ZIP**) and add it with **Sketch → Include Library → Add .ZIP Library**. If you have TFT_eSPI installed, remove it first; they conflict.
4. Open `firmware/kitchen_wall/kitchen_wall.ino`. Copy `config.example.h` to `config.h` in the same folder and fill in your Wi-Fi name and password (2.4 GHz only) and the token from step 4.
5. Plug the screen into your computer with USB-C. Set **Tools → Board** to **XIAO_ESP32S3** and **Tools → PSRAM** to **OPI PSRAM**, pick the port, and click **Upload**.

The screen draws the Month page within a minute. Hang it tall. If the picture is upside down, change `"rotate"` in `config.json` to `180` and `ROTATE` in `config.h` to `180`, then upload again.

---

## Living with it

**Corner squares.** A small square in the top-right corner means something needs attention:
- **Red**: battery is low. Charge over USB-C.
- **Yellow**: the pages haven't updated in 3+ hours. Usually Wi-Fi, an expired GitHub token, or the calendar address changed. The **Actions** tab shows any errors.

**Battery.** Color e-ink uses most of its power on each redraw (about 20 seconds). The screen only redraws when a page actually changes and sleeps overnight, so expect weeks to a couple of months per charge, depending on how busy the calendar is and how often the buttons get pressed. That's a guess until it's been on the wall a while.

**Changing settings.** Edit `config.json` on GitHub; the next run uses it.

| Setting | What it does |
|---|---|
| `dinner.readyBy`, `dinner.eatAt` | When food should be ready and when you eat. Start-by times count back from `readyBy`. |
| `timezone`, `weather` | Where you are. If you move, also change the times in `.github/workflows/render.yml` (they're in UTC). |
| `choreWords` | Words that make an all-day event a morning chore. |
| `quietHours` | When the screen doesn't wake up. |
| `weeksShown` | How many weeks the calendar shows. |
| `photoHeight` | How tall the photo is, out of 1600. Lower it for more calendar. |

**Changing the menu.** `menu.json` holds the week's breakfasts and dinners, each dinner's lead time, and the before-bed thaw. When the Toddler Weekly Menu changes, ask Claude to update `menu.json` to match.

## Trying it on a computer

```
cd render
npm install
npm run sample      # draws the sample calendar into out/
```
