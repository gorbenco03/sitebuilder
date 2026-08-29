# Flow 2 browser evidence — remediation r3

Target: local isolated builder with `HIDOOK_TEST_PAY=1` and `HIDOOK_ISOLATED_DEPLOY=1`.
Browser: Brave through Playwright, 1440 × 1000 viewport.

## Verified

- `01-replace-photo-clickable.png`: normal hover and click on the Restaurant hero `Înlocuiește fotografia` control opened the browser file chooser.
- `02-instagram-connected-reopen.png`: after consent/connect and reopening `Adaugă Instagram`, the modal shows the persisted Romanian `Instagram conectat` panel and Instafidget editor control.
- `03-cancel-dismissed-still-live.png`: dismissing the Romanian confirmation sent zero billing-portal requests; the site remained `Activ` and `Anulează` remained available.
- `04-cancel-confirmed-draft.png`: accepting the same confirmation changed the project to `Ciornă`; the former live URL returned HTTP 404.

Confirmation copy observed: `Sigur vrei să anulezi abonamentul pentru „casa-nord”? Site-ul nu va mai fi public după confirmare.`
