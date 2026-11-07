<h3 align="center"><img width="80" alt="Puter.com, calculatorul personal în cloud: toate fișierele, aplicațiile și jocurile tale într-un singur loc, accesibile de oriunde și oricând." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Sistemul de operare al internetului! Gratuit, open-source și găzduibil autonom.</h3>

<p align="center">
    <img alt="Dimensiunea repoului GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Versiunea de pe GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=ultima%20versiune"> <img alt="Licență GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« DEMO LIVE »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">SDK</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://www.youtube.com/@EricsPuterVideos">YouTube</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (Twitter)</a>
    ·
    <a href="https://hackerone.com/puter_h1b">Program de recompense pentru identificarea bugurilor</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="captură de ecran" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter este un sistem de operare pe internet, avansat, open-source, conceput să fie bogat în funcționalități, excepțional de rapid și foarte extensibil. Puter poate fi folosit ca:

* Un cloud personal cu accent pe confidențialitate, pentru a-ți păstra toate fișierele, aplicațiile și jocurile într-un singur loc securizat, accesibil de oriunde și oricând.
* O platformă pentru a construi și publica site-uri, aplicații web și jocuri.
* O alternativă la Dropbox, Google Drive, OneDrive etc., cu o interfață nouă și funcționalități puternice.
* Un mediu desktop la distanță pentru servere și stații de lucru.
* Un proiect și o comunitate, open-source și prietenoase, pentru a învăța despre dezvoltare web, cloud computing, sisteme distribuite și multe altele!

<br/>

## Fă primii pași

### 💻 Dezvoltare locală

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Aceasta va porni Puter la [http://puter.localhost:4100](http://puter.localhost:4100) (sau pe următorul port disponibil).

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

### 🐙 Docker Compose

#### Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

#### Windows

```powershell
mkdir -p puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```

<br/>

### ☁️ Puter.com

Puter este disponibil ca serviciu găzduit la adresa [**puter.com**](https://puter.com).

<br/>

## Cerințe de sistem

* **Sisteme de operare:** Linux, macOS, Windows
* **RAM:** minimum 2GB (recomandat 4GB)
* **Spațiu pe disc:** 1GB spațiu liber
* **Node.js:** versiunea 16+ (versiunea 22+ recomandată)
* **npm:** ultima versiune stabilă

<br/>

## Suport

Ia legătura cu cei care asigură mentenanța proiectului și cu comunitatea prin aceste canale:

* Vrei să raportezi un bug sau să ceri o funcționalitate? Te rugăm să [deschizi o problemă](https://github.com/HeyPuter/puter/issues/new/choose).
* Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
* X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
* Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
* Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
* Probleme de securitate? [security@puter.com](mailto:security@puter.com)
* Trimite un e-mail celor care asigură mentenanța proiectului la [hi@puter.com](mailto:hi@puter.com)

Suntem întotdeauna bucuroși să te ajutăm cu orice întrebări ai. Nu ezita să ne pui întrebări!

<br/>

## Licență

Acest repository, inclusiv tot conținutul său, subproiectele, modulele și componentele, este licențiat sub [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), cu excepția cazurilor în care se menționează explicit altfel. Bibliotecile terțe incluse în acest repository pot fi supuse propriilor lor licențe.

<br/>

