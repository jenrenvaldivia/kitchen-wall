/*
 * Kitchen wall screen for the Seeed reTerminal E1004 (13.3" six-color e-paper).
 *
 * Each time it wakes (every 30 minutes, or when a front button is pressed) it:
 *   1. joins Wi-Fi and asks GitHub whether the page it should show has changed,
 *   2. downloads that page (already drawn and converted by the renderer) only if it changed,
 *   3. redraws the panel, keeps a copy on the SD card, and goes back to deep sleep.
 *
 * Buttons: right or left = switch page, refresh = redraw now.
 * Pages: 0 Home (photo + calendar), 1 Today's meals. Meals goes back to Home after a while.
 *
 * Corner marks: red square = battery low; yellow square = no update for 3+ hours (check Wi-Fi).
 *
 * Arduino IDE: board "XIAO_ESP32S3", Tools > PSRAM > "OPI PSRAM", library "Seeed_GFX".
 * Pin numbers come from Seeed's reTerminal E1004 examples and peripheral guide.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <SD.h>
#include <time.h>
#include "esp_sleep.h"
#include "TFT_eSPI.h"
#include "config.h"

#ifndef EPAPER_ENABLE
#error "Seeed_GFX isn't set up for the E1004. Keep driver.h next to this sketch."
#endif

// ---- hardware ---------------------------------------------------------------
static const int KEY_NEXT = 3;      // right button
static const int KEY_PREV = 4;      // left button
static const int KEY_REFRESH = 5;   // refresh button
static const int BATT_ADC = 1, BATT_EN = 21;
static const int SD_CS = 14, SD_EN = 16, SPI_SCK = 7, SPI_MISO = 8, SPI_MOSI = 9;
#define LOG Serial1                 // the reTerminal's USB-serial bridge is on UART1 (TX 43, RX 44)

static const int PANEL_W = 1200, PANEL_H = 1600;
static const size_t FRAME_BYTES = PANEL_W * PANEL_H / 2;  // 4 bits per pixel
static const char* PAGES[] = {"home", "meals"};
static const int PAGE_COUNT = 2;

// ---- remembered across deep sleep -------------------------------------------
RTC_DATA_ATTR int page = 0;                 // page that should be showing
RTC_DATA_ATTR int shownPage = -1;           // page actually on the panel
RTC_DATA_ATTR char shownSha[41] = "";       // version of the page on the panel
RTC_DATA_ATTR time_t pageChosenAt = 0;      // when someone last pressed a page button
RTC_DATA_ATTR time_t lastSuccess = 0;       // last time GitHub answered
RTC_DATA_ATTR bool shownWithMark = false;   // panel currently shows a warning square

EPaper epaper;

// ---- small helpers ----------------------------------------------------------
static float batteryVolts() {
  pinMode(BATT_EN, OUTPUT);
  digitalWrite(BATT_EN, HIGH);
  delay(5);
  analogReadResolution(12);
  analogSetPinAttenuation(BATT_ADC, ADC_11db);
  uint32_t mv = analogReadMilliVolts(BATT_ADC);
  digitalWrite(BATT_EN, LOW);
  return mv / 1000.0f * 2.0f;  // 2:1 divider on the board
}

static bool joinWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 80 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  LOG.printf("[wifi] %s\n", WiFi.status() == WL_CONNECTED ? "connected" : "failed");
  return WiFi.status() == WL_CONNECTED;
}

static bool syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  for (int i = 0; i < 40; i++) { if (time(nullptr) > 1700000000) return true; delay(250); }
  return false;
}

// GitHub API GET. accept = "application/vnd.github.raw" for file bytes.
static int githubGet(HTTPClient& http, WiFiClientSecure& tls, const String& path, const char* accept) {
  // The token only reads this one repository. Certificate checking is skipped to keep setup simple.
  tls.setInsecure();
  String url = String("https://api.github.com/repos/") + GITHUB_REPO + "/contents/" + path + "?ref=" + GITHUB_BRANCH;
  http.begin(tls, url);
  http.setTimeout(20000);
  http.addHeader("Authorization", String("Bearer ") + GITHUB_TOKEN);
  http.addHeader("Accept", accept);
  http.addHeader("User-Agent", "kitchen-wall-screen");
  http.addHeader("X-GitHub-Api-Version", "2022-11-28");
  return http.GET();
}

// Finds the "sha" of a file in GitHub's directory listing, without a JSON library.
static String shaFor(const String& listing, const char* file) {
  int at = listing.indexOf(String("\"") + file + "\"");
  if (at < 0) return "";
  int key = listing.indexOf("\"sha\"", at);
  if (key < 0) return "";
  int q = listing.indexOf('"', listing.indexOf(':', key) + 1);
  return q < 0 ? "" : listing.substring(q + 1, q + 41);
}

static int jsonInt(const String& j, const char* key, int fallback) {
  int at = j.indexOf(String("\"") + key + "\"");
  if (at < 0) return fallback;
  at = j.indexOf(':', at);
  return j.substring(at + 1).toInt();
}
static int jsonClock(const String& j, const char* key, int fallback) {  // "21:30" -> minutes
  int at = j.indexOf(String("\"") + key + "\"");
  if (at < 0) return fallback;
  at = j.indexOf('"', j.indexOf(':', at)) + 1;
  return j.substring(at, at + 2).toInt() * 60 + j.substring(at + 3, at + 5).toInt();
}

// Collects an HTTP body straight into the frame buffer (HTTPClient handles chunked replies).
class FrameSink : public Stream {
 public:
  FrameSink(uint8_t* b, size_t cap) : buf(b), cap(cap) {}
  size_t write(uint8_t c) override { if (len < cap) buf[len++] = c; return 1; }
  size_t write(const uint8_t* d, size_t n) override {
    size_t k = (len + n <= cap) ? n : cap - len;
    memcpy(buf + len, d, k); len += k; return n;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
  size_t len = 0;
 private:
  uint8_t* buf; size_t cap;
};

static bool download(const char* file, uint8_t* buf) {
  WiFiClientSecure tls; HTTPClient http;
  int code = githubGet(http, tls, String(file), "application/vnd.github.raw");
  if (code != 200) { LOG.printf("[get] %s -> %d\n", file, code); http.end(); return false; }
  FrameSink sink(buf, FRAME_BYTES);
  http.writeToStream(&sink);
  http.end();
  LOG.printf("[get] %s: %u of %u bytes\n", file, (unsigned)sink.len, (unsigned)FRAME_BYTES);
  return sink.len == FRAME_BYTES;
}

// SD card copy of each page, so buttons work and warnings can be drawn without Wi-Fi.
static bool sdReady = false;
static void startSD() {
  pinMode(SD_EN, OUTPUT); digitalWrite(SD_EN, HIGH); delay(50);
  SPIClass& spi = epaper.getSPIinstance();
  spi.end(); spi.begin(SPI_SCK, SPI_MISO, SPI_MOSI, -1);
  sdReady = SD.begin(SD_CS, spi);
  LOG.printf("[sd] %s\n", sdReady ? "ready" : "not available");
}
static String cachePath(int p) { return String("/wall/") + PAGES[p] + ".bin"; }
static void saveCache(int p, const uint8_t* buf) {
  if (!sdReady) return;
  SD.mkdir("/wall");
  File f = SD.open(cachePath(p), FILE_WRITE);
  if (f) { f.write(buf, FRAME_BYTES); f.close(); }
}
static bool loadCache(int p, uint8_t* buf) {
  if (!sdReady) return false;
  File f = SD.open(cachePath(p), FILE_READ);
  if (!f) return false;
  size_t n = f.read(buf, FRAME_BYTES); f.close();
  return n == FRAME_BYTES;
}

// Small square in the screen's top-right corner (as the screen hangs), in panel coordinates.
static void cornerMark(uint32_t color, int slot) {
  const int size = 34, gap = 10, inset = 14;
  int along = inset + slot * (size + gap);   // distance from the right edge as it hangs
  int x, y;
  if (ROTATE == 180) { x = along;                   y = PANEL_H - inset - size; }
  else               { x = PANEL_W - along - size;  y = inset; }
  epaper.fillRect(x, y, size, size, color);
}

static void show(uint8_t* buf, bool lowBattery, bool stale) {
  epaper.pushImage(0, 0, PANEL_W, PANEL_H, (uint16_t*)buf);
  int slot = 0;
  if (lowBattery) cornerMark(TFT_RED, slot++);
  if (stale) cornerMark(TFT_YELLOW, slot++);
  epaper.update();
  shownWithMark = lowBattery || stale;
}

static void sleepFor(uint32_t seconds) {
  // Don't sleep while a button is still held, or it would wake straight back up.
  while (!digitalRead(KEY_NEXT) || !digitalRead(KEY_PREV) || !digitalRead(KEY_REFRESH)) delay(20);
  epaper.sleep();
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  LOG.printf("[sleep] %lu s\n", (unsigned long)seconds); LOG.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  esp_sleep_enable_ext1_wakeup((1ULL << KEY_NEXT) | (1ULL << KEY_PREV) | (1ULL << KEY_REFRESH), ESP_EXT1_WAKEUP_ANY_LOW);
  esp_deep_sleep_start();
}

// Seconds until the next check: a while after each half-hour render, or the end of quiet hours.
static uint32_t nextWake(time_t now, int offsetMin, int quietFrom, int quietTo) {
  long local = ((long)(now / 60) + offsetMin) % 1440; if (local < 0) local += 1440;
  bool quiet = quietFrom > quietTo ? (local >= quietFrom || local < quietTo) : (local >= quietFrom && local < quietTo);
  if (quiet) {
    long until = (quietTo - local + 1440) % 1440;
    return (uint32_t)(until * 60 + 5 * 60);
  }
  int m = local % 60, target = m < 20 ? 20 : (m < 50 ? 50 : 80);  // pages are drawn at :07 and :37; GitHub often starts late
  return (uint32_t)((target - m) * 60);
}

void setup() {
  LOG.begin(115200, SERIAL_8N1, 44, 43);
  pinMode(KEY_NEXT, INPUT); pinMode(KEY_PREV, INPUT); pinMode(KEY_REFRESH, INPUT);

  bool force = false, pressed = false;
  esp_sleep_wakeup_cause_t why = esp_sleep_get_wakeup_cause();
  if (why == ESP_SLEEP_WAKEUP_EXT1) {
    uint64_t bits = esp_sleep_get_ext1_wakeup_status();
    if (bits & (1ULL << KEY_NEXT)) page = (page + 1) % PAGE_COUNT;
    else if (bits & (1ULL << KEY_PREV)) page = (page + PAGE_COUNT - 1) % PAGE_COUNT;
    else force = true;
    pressed = true;
  } else if (why != ESP_SLEEP_WAKEUP_TIMER) {
    force = true;  // first power-on
  }
  LOG.printf("[wake] cause=%d page=%s\n", (int)why, PAGES[page]);

  epaper.begin();
  startSD();
  uint8_t* buf = (uint8_t*)ps_malloc(FRAME_BYTES);
  if (!buf) { LOG.println("[mem] no PSRAM: enable Tools > PSRAM > OPI PSRAM"); sleepFor(1800); }

  int offsetMin = -420, quietFrom = 21 * 60 + 30, quietTo = 5 * 60 + 30, mealsReturn = 60;
  long generated = 0;
  bool online = joinWifi() && syncClock();
  time_t now = time(nullptr);
  if (pressed) pageChosenAt = now;
  bool lowBattery = batteryVolts() < 3.5f;

  String listing;
  if (online) {
    WiFiClientSecure tls; HTTPClient http;
    int code = githubGet(http, tls, "", "application/vnd.github+json");
    if (code == 200) listing = http.getString();
    http.end();
    LOG.printf("[list] %d\n", code);
    WiFiClientSecure tls2; HTTPClient http2;
    if (githubGet(http2, tls2, "manifest.json", "application/vnd.github.raw") == 200) {
      String m = http2.getString();
      offsetMin = jsonInt(m, "utcOffsetMinutes", offsetMin);
      quietFrom = jsonClock(m, "from", quietFrom);
      quietTo = jsonClock(m, "to", quietTo);
      mealsReturn = jsonInt(m, "mealsPageReturnsAfterMinutes", mealsReturn);
      generated = jsonInt(m, "generatedEpoch", 0);
    }
    http2.end();
    if (listing.length()) lastSuccess = now;
  }

  // Today's meals goes back to the home page after a while.
  if (!pressed && page == 1 && now - pageChosenAt > (time_t)mealsReturn * 60) page = 0;

  // Stale = the pages haven't been redrawn in 3+ hours (renderer stopped), or we can't reach GitHub.
  bool clockOk = now > 1700000000;
  bool stale = lastSuccess == 0
            || (clockOk && generated > 0 && now - generated > 3 * 3600)
            || (clockOk && !online && now - lastSuccess > 3 * 3600);
  String sha = listing.length() ? shaFor(listing, (String(PAGES[page]) + ".bin").c_str()) : "";
  bool changed = sha.length() && sha != String(shownSha);
  bool markChanged = (lowBattery || stale) != shownWithMark;

  if (force || page != shownPage || changed || markChanged) {
    bool have = false;
    if (sha.length() && (changed || page != shownPage || force)) {
      have = download((String(PAGES[page]) + ".bin").c_str(), buf);
      if (have) { saveCache(page, buf); strncpy(shownSha, sha.c_str(), 40); shownSha[40] = 0; }
    }
    if (!have) have = loadCache(page, buf);
    if (have) { show(buf, lowBattery, stale); shownPage = page; }
    else LOG.println("[show] nothing to draw yet");
  } else {
    LOG.println("[show] already up to date");
  }

  uint32_t wait = online ? nextWake(now, offsetMin, quietFrom, quietTo) : 15 * 60;
  sleepFor(wait);
}

void loop() {}
