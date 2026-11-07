// @vitest-environment jsdom
/** CSV import of vehicles, contacts, parts, and fuel. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, fakeFile, chooseFile, clickButton, settle } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { importVehicles } from '../src/views/importers.js';

beforeAll(polyfill);

describe('vehicle import', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('records each meter on the vehicle in the same row, even after a skipped row', async () => {
    importVehicles();
    const dlg = await chooseFile(fakeFile('Name,VIN,Make,Meter\n,,,999\nVan 1,,Ford,1000\nVan 2,,Ford,2000\n'));
    clickButton(dlg, 'Import');
    await settle();
    const byName = Object.fromEntries(app.store.all('vehicles').map((v) => [v.name, v]));
    expect(byName['Van 1'].meter).toBe(1000);
    expect(byName['Van 2'].meter).toBe(2000);
  });
});

describe('import validation and the skipped-rows report', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('skips vehicles whose VIN is already in the fleet or earlier in the file', async () => {
    app.store.put('vehicles', { name: 'Existing', vin: '1FTBW2CM5HKA12345', archived: false });
    importVehicles();
    const dlg = await chooseFile(fakeFile('Name,VIN\nA,1ftbw2cm5hka12345\nB,2FTBW2CM5HKA00001\nC,2FTBW2CM5HKA00001\nD,\n'));
    expect(dlg.textContent).toMatch(/2 of 4 rows/);
    expect(dlg.textContent).toMatch(/Row 2: .*already used by Existing/);
    expect(dlg.textContent).toMatch(/Row 4: .*same VIN as row 3/i);
    clickButton(dlg, 'Import');
    await settle();
    expect(app.store.all('vehicles').map((v) => v.name).sort()).toEqual(['B', 'D', 'Existing']);
  });

  it('counts only rows that will really be added and says why the others are skipped', async () => {
    importVehicles();
    const dlg = await chooseFile(fakeFile('Color,Plate\nRed,ABC\nBlue,DEF\n'));
    expect(dlg.textContent).toMatch(/0 of 2 rows/);
    expect(dlg.textContent).toMatch(/Row 2: Needs a name, VIN, or make/);
  });

  it('reports fuel rows whose vehicle is not found instead of silently dropping them', async () => {
    const { importFuel } = await import('../src/views/importers.js');
    app.store.put('vehicles', { name: 'Van 1', archived: false });
    importFuel();
    const dlg = await chooseFile(fakeFile('Vehicle,Date,Volume,Total\nVan 1,2026-10-01,10,40.00\nVan 9,2026-10-02,12,48.00\n'));
    expect(dlg.textContent).toMatch(/1 of 2 rows/);
    expect(dlg.textContent).toMatch(/Row 3: No vehicle matches "Van 9"/);
  });

  it('offers the skipped rows as a CSV with the reason for each', async () => {
    let saved = null;
    const orig = URL.createObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => ((saved = blob), 'blob:x');
    URL.revokeObjectURL ??= () => {};
    HTMLAnchorElement.prototype.click = () => {};
    try {
      importVehicles();
      const dlg = await chooseFile(fakeFile('Color,Name\nRed,\nBlue,Van 2\n'));
      clickButton(dlg, 'Download skipped rows');
    } finally {
      URL.createObjectURL = orig;
      HTMLAnchorElement.prototype.click = click;
    }
    const body = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsText(saved);
    });
    expect(body).toBe('Row,Problem,Color,Name\r\n2,"Needs a name, VIN, or make",Red,\r\n');
  });
});

describe('file encodings and separators', () => {
  beforeEach(async () => {
    await freshStore();
  });

  const importBytes = async (bytes) => {
    importVehicles();
    const dlg = await chooseFile(fakeFile(bytes));
    clickButton(dlg, 'Import');
    await settle();
    return app.store.all('vehicles').map((v) => v.name);
  };

  it('reads a Windows-1252 file saved by older Excel without garbling accents', async () => {
    // "Name\r\nCafé 1\r\n" in Windows-1252: é is the single byte 0xE9.
    const bytes = new Uint8Array([...new TextEncoder().encode('Name\r\nCaf'), 0xe9, ...new TextEncoder().encode(' 1\r\n')]);
    expect(await importBytes(bytes)).toEqual(['Café 1']);
  });

  it('reads a UTF-16 file with a byte order mark', async () => {
    const s = 'Name\tMake\r\nÜnit 7\tFord\r\n';
    const bytes = new Uint8Array(2 + s.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < s.length; i++) bytes[2 + i * 2] = s.charCodeAt(i) & 0xff;
    expect(await importBytes(bytes)).toEqual(['Ünit 7']);
  });

  it('reads semicolon-separated files, as Excel saves them in many locales', async () => {
    expect(await importBytes('Name;Make;Model\nVan 1;Ford;Transit\n')).toEqual(['Van 1']);
    expect(app.store.all('vehicles')[0].make).toBe('Ford');
  });

  it('keeps commas inside quoted fields of a comma-separated file', async () => {
    expect(await importBytes('Name,Model\n"Truck 4, north",F-150\n')).toEqual(['Truck 4, north']);
  });
});

describe('import dates', () => {
  it('rejects dates that do not exist instead of storing them', async () => {
    const { parseDate } = await import('../src/views/importers.js');
    expect(parseDate('2026-10-12')).toBe('2026-10-12');
    expect(parseDate('10/12/2026')).toBe('2026-10-12');
    expect(parseDate('25.12.2026')).toBe('2026-12-25');
    expect(parseDate('2026-13-45')).toBeNull();
    expect(parseDate('02/30/2026')).toBeNull();
    expect(parseDate('13/13/2026')).toBeNull();
    expect(parseDate('0/5/2026')).toBeNull();
  });
});

describe('vehicle type and fuel type', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it("match the fleet's lists whatever their capitalization", async () => {
    importVehicles();
    const dlg = await chooseFile(fakeFile('Name,Type,Fuel type\nVan 1,van,DIESEL\nCar 2,Pickup Truck,electric\nRig,Crane,Hydrogen\n'));
    clickButton(dlg, 'Import');
    await settle();
    const by = Object.fromEntries(app.store.all('vehicles').map((v) => [v.name, [v.type, v.fuelType]]));
    expect(by['Van 1']).toEqual(['Van', 'Diesel']);
    expect(by['Car 2']).toEqual(['Pickup truck', 'Electric']);
    // Values the fleet does not list yet are kept as written.
    expect(by.Rig).toEqual(['Crane', 'Hydrogen']);
  });
});

describe('vehicle values the form would refuse', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('skips rows with an impossible year or a negative meter, as the vehicle form does', async () => {
    importVehicles();
    const dlg = await chooseFile(fakeFile('Name,Year,Meter\nA,19,100\nB,2019,-5\nC,2019,100\n'));
    expect(dlg.textContent).toMatch(/1 of 3 rows/);
    expect(dlg.textContent).toMatch(/Row 2: Year 19/);
    expect(dlg.textContent).toMatch(/Row 3: Meter/);
  });
});

describe('fuel values the fuel form would refuse', () => {
  beforeEach(async () => {
    await freshStore();
    app.store.put('vehicles', { name: 'Van 1', archived: false });
  });

  it('skips future dates, missing volumes, and rows with no cost', async () => {
    const { importFuel } = await import('../src/views/importers.js');
    importFuel();
    const dlg = await chooseFile(fakeFile('Vehicle,Date,Volume,Price,Total\nVan 1,2026-10-01,10,,40.00\nVan 1,2026-12-01,10,,40.00\nVan 1,2026-10-02,,,40.00\nVan 1,2026-10-03,10,,\nVan 1,2026-10-04,10,4.00,\n'));
    expect(dlg.textContent).toMatch(/2 of 5 rows/);
    expect(dlg.textContent).toMatch(/Row 3: .*future/);
    expect(dlg.textContent).toMatch(/Row 4: .*volume/i);
    expect(dlg.textContent).toMatch(/Row 5: .*total or a price/);
    clickButton(dlg, 'Import');
    await settle();
    expect(app.store.all('fuel').map((f) => f.total).sort()).toEqual([4000, 4000]);
  });
});

describe('large fuel imports', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('records odometer readings and the vehicle meter like a fuel entry does', async () => {
    const { importFuel } = await import('../src/views/importers.js');
    const v = app.store.put('vehicles', { name: 'Van 1', archived: false });
    importFuel();
    const dlg = await chooseFile(fakeFile('Vehicle,Date,Odometer,Volume,Total\nVan 1,2026-10-01,1000,10,40\nVan 1,2026-10-05,1300,10,40\nVan 1,2026-10-03,,10,40\n'));
    clickButton(dlg, 'Import');
    await settle();
    const fuel = app.store.all('fuel');
    const readings = app.store.all('meters');
    expect(readings.map((m) => m.value).sort()).toEqual([1000, 1300]);
    for (const m of readings) expect(fuel.find((f) => f.id === m.source.id && m.source.type === 'fuel').meter).toBe(m.value);
    expect(app.store.get('vehicles', v.id)).toMatchObject({ meter: 1300, meterDate: '2026-10-05' });
  });

  it('imports 20,000 rows without freezing the page', async () => {
    const { importFuel } = await import('../src/views/importers.js');
    app.store.put('vehicles', { name: 'Van 1', archived: false });
    const lines = ['Vehicle,Date,Odometer,Volume,Total'];
    for (let i = 0; i < 20000; i++) lines.push(`Van 1,2026-0${1 + (i % 9)}-1${i % 9},${1000 + i * 10},10,40.00`);
    importFuel();
    const dlg = await chooseFile(fakeFile(lines.join('\n')));
    const t = performance.now();
    clickButton(dlg, 'Import');
    // It took about 10 seconds when each row looked up every earlier reading.
    expect(performance.now() - t).toBeLessThan(2500);
    expect(app.store.all('fuel').length).toBe(20000);
    expect(app.store.all('meters').length).toBe(20000);
  }, 30000);
});

describe('contact import', () => {
  beforeEach(async () => {
    await freshStore();
  });

  it('skips contacts whose email the contact form would refuse', async () => {
    const { importContacts } = await import('../src/views/importers.js');
    importContacts();
    const dlg = await chooseFile(fakeFile('Name,Email\nAna Diaz,ana@example.com\nBen Ruiz,ben at example\n'));
    expect(dlg.textContent).toMatch(/1 of 2 rows/);
    expect(dlg.textContent).toMatch(/Row 3: .*ben at example/);
  });
});
