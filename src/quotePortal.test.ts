import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

interface PricingConfig {
  currency: string;
  unitLabel: string;
  depositRate: number;
  balanceRate: number;
  defaultFreightPerTon: number;
  products: Record<string, { unitRate: number; defaultTons: number }>;
  packaging: Record<string, { id: string; label: string; adderPerTon: number; tonsPerLoad: number }>;
}

interface InvoiceBreakdown {
  packaging: { id: string; label: string; adderPerTon: number };
  freightPerTon: number;
  lineItems: Array<{ id: string; tons: number; unitRate: number; lineTotal: number }>;
  selectedItems: Array<{ id: string; name: string; grade: string; cas: string; tons: number; unitRate: number; lineTotal: number }>;
  totalTons: number;
  productSubtotal: number;
  packagingTotal: number;
  freightTotal: number;
  packagingAndFreightTotal: number;
  grandTotal: number;
  depositAmount: number;
  balanceAmount: number;
  logisticsEstimate: string;
}

interface PortalLogic {
  PRICING_CONFIG: PricingConfig;
  COMPANY_INFO: {
    name: string;
    address: string;
    phone: string;
    whatsapp: string;
    email: string;
    webUrlSlot: string;
  };
  COMMODITIES: ReadonlyArray<{ id: string; grade: string; cas: string }>;
  formatUSD: (amount: number) => string;
  calculateProFormaInvoice: (params: {
    quantities: Record<string, number>;
    packagingId: string;
    freightPerTon: number;
  }) => InvoiceBreakdown;
  validateInvoiceRequest: (
    input: {
      buyerName?: string;
      businessName?: string;
      deliveryLocation?: string;
      buyerEmail?: string;
      includeCatalogSds?: boolean;
    },
    invoice: InvoiceBreakdown
  ) => { valid: boolean; errors: Record<string, string> };
  formatInvoiceEmail: (
    input: {
      buyerName?: string;
      businessName?: string;
      deliveryLocation?: string;
      buyerEmail?: string;
      buyerPhone?: string;
      requestFormalInvoice?: boolean;
      includeCatalogSds?: boolean;
      notes?: string;
    },
    invoice: InvoiceBreakdown
  ) => {
    to: string;
    subject: string;
    body: string;
    mailtoHref: string;
    clipboardText: string;
  };
}

function loadPortalLogicFromIndexHtml(): PortalLogic {
  const htmlPath = path.resolve(process.cwd(), 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script id="portal-logic">([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'index.html must contain the inline <script id="portal-logic"> block');

  const loader = new Function(`${match[1]}; return globalThis.__ANS_PORTAL_LOGIC__;`);
  return loader() as PortalLogic;
}

const logic = loadPortalLogicFromIndexHtml();

test('PRICING_CONFIG and company metadata match exact indicative rates and San Rafael details', () => {
  assert.equal(logic.PRICING_CONFIG.products['urea-46-0-0'].unitRate, 750);
  assert.equal(logic.PRICING_CONFIG.products['urea-46-0-0'].defaultTons, 20);
  assert.equal(logic.PRICING_CONFIG.products['dap-18-46-0'].unitRate, 945);
  assert.equal(logic.PRICING_CONFIG.products['dap-18-46-0'].defaultTons, 0);
  assert.equal(logic.PRICING_CONFIG.products['potash-0-0-60'].unitRate, 525);
  assert.equal(logic.PRICING_CONFIG.products['potash-0-0-60'].defaultTons, 0);

  assert.equal(logic.PRICING_CONFIG.packaging['bulk-hopper'].adderPerTon, 0);
  assert.equal(logic.PRICING_CONFIG.packaging['super-sacks'].adderPerTon, 45);
  assert.equal(logic.PRICING_CONFIG.defaultFreightPerTon, 65);

  assert.equal(logic.COMPANY_INFO.name, 'A & S Landscape Materials, Inc.');
  assert.equal(logic.COMPANY_INFO.address, '580 Jacoby Street, San Rafael, CA 94901');
  assert.equal(logic.COMPANY_INFO.phone, '+1 205-205-5600');
  assert.equal(logic.COMPANY_INFO.whatsapp, '+1 (985) 299-8282');
  assert.equal(logic.COMPANY_INFO.email, 'Sales.ansmaterials@gmail.com');
});

test('calculateProFormaInvoice computes default 20t Urea bulk hopper totals and 20%/80% milestones', () => {
  const inv = logic.calculateProFormaInvoice({
    quantities: { 'urea-46-0-0': 20, 'dap-18-46-0': 0, 'potash-0-0-60': 0 },
    packagingId: 'bulk-hopper',
    freightPerTon: 65,
  });

  assert.equal(inv.totalTons, 20);
  assert.equal(inv.selectedItems.length, 1);
  assert.equal(inv.productSubtotal, 15000);
  assert.equal(inv.packagingTotal, 0);
  assert.equal(inv.freightTotal, 1300);
  assert.equal(inv.packagingAndFreightTotal, 1300);
  assert.equal(inv.grandTotal, 16300);
  assert.equal(inv.depositAmount, 3260);
  assert.equal(inv.balanceAmount, 13040);
});

test('calculateProFormaInvoice computes multi-product Super Sacks (+$45/t) and custom freight accurately', () => {
  const inv = logic.calculateProFormaInvoice({
    quantities: { 'urea-46-0-0': 20, 'dap-18-46-0': 22, 'potash-0-0-60': 10 },
    packagingId: 'super-sacks',
    freightPerTon: 80,
  });

  // Product subtotal: 20*750 (15,000) + 22*945 (20,790) + 10*525 (5,250) = 41,040
  // Total tons: 52
  // Packaging: 52 * 45 = 2,340
  // Freight: 52 * 80 = 4,160
  // Pack + Freight: 6,500
  // Grand Total: 47,540
  // 20% Deposit: 9,508; 80% Balance: 38,032
  assert.equal(inv.totalTons, 52);
  assert.equal(inv.selectedItems.length, 3);
  assert.equal(inv.productSubtotal, 41040);
  assert.equal(inv.packagingTotal, 2340);
  assert.equal(inv.freightTotal, 4160);
  assert.equal(inv.packagingAndFreightTotal, 6500);
  assert.equal(inv.grandTotal, 47540);
  assert.equal(inv.depositAmount, 9508);
  assert.equal(inv.balanceAmount, 38032);
  assert.equal(inv.depositAmount + inv.balanceAmount, inv.grandTotal);
});

test('validateInvoiceRequest rejects missing required fields and invalid email', () => {
  const emptyInv = logic.calculateProFormaInvoice({
    quantities: { 'urea-46-0-0': 0, 'dap-18-46-0': 0, 'potash-0-0-60': 0 },
    packagingId: 'bulk-hopper',
    freightPerTon: 65,
  });

  const invalid = logic.validateInvoiceRequest(
    {
      buyerName: '',
      businessName: '',
      deliveryLocation: '',
      buyerEmail: 'not-an-email',
      includeCatalogSds: false,
    },
    emptyInv
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.buyerName);
  assert.ok(invalid.errors.businessName);
  assert.ok(invalid.errors.deliveryLocation);
  assert.ok(invalid.errors.buyerEmail);
  assert.ok(invalid.errors.orderItems);
});

test('formatInvoiceEmail builds exact required subject, itemized totals, and mailto URI', () => {
  const inv = logic.calculateProFormaInvoice({
    quantities: { 'urea-46-0-0': 20, 'dap-18-46-0': 22, 'potash-0-0-60': 0 },
    packagingId: 'super-sacks',
    freightPerTon: 70,
  });

  const email = logic.formatInvoiceEmail(
    {
      buyerName: 'Elena Vasquez',
      businessName: 'Sonoma Valley Growers LLC',
      deliveryLocation: 'Sonoma County, CA',
      buyerEmail: 'elena@sonomagrowers.com',
      buyerPhone: '+1 (707) 555-0144',
      requestFormalInvoice: true,
      includeCatalogSds: true,
      notes: 'Forklift available on site.',
    },
    inv
  );

  assert.equal(email.to, 'Sales.ansmaterials@gmail.com');
  assert.equal(
    email.subject,
    'Invoice & Catalog Request — Sonoma Valley Growers LLC (Sonoma County, CA)'
  );
  assert.match(email.body, /Granular Urea \(46-0-0 \| CAS 57-13-6\): 20 short tons × \$750\.00\/ton = \$15,000\.00/);
  assert.match(email.body, /Diammonium Phosphate \(DAP\) \(18-46-0 \| CAS 7783-28-0\): 22 short tons × \$945\.00\/ton = \$20,790\.00/);
  assert.match(email.body, /Estimated Order Total:\s+\$40,620\.00/);
  assert.match(email.body, /20% Deposit \(Lock Allocation\):\s+\$8,124\.00/);
  assert.match(email.body, /80% Farm-Gate BOL Balance:\s+\$32,496\.00/);
  assert.ok(email.mailtoHref.startsWith('mailto:Sales.ansmaterials@gmail.com?subject='));
  assert.ok(email.mailtoHref.includes(encodeURIComponent(email.subject)));
});
