// Copy this file to config.h (same folder) and fill it in. config.h is ignored by git,
// so your Wi-Fi password and token never end up in the repository.
#pragma once

// Your home Wi-Fi. The screen only works on 2.4 GHz networks.
#define WIFI_SSID      "your-wifi-name"
#define WIFI_PASSWORD  "your-wifi-password"

// A GitHub fine-grained token with read-only "Contents" access to this one repository.
// The README walks through making it.
#define GITHUB_TOKEN   "github_pat_..."
#define GITHUB_REPO    "jenrenvaldivia/kitchen-wall"
#define GITHUB_BRANCH  "display"

// 90 or 270. Must match "rotate" in config.json. If the picture is upside down, switch both.
#define ROTATE         90
