# Launch scope — November 1, 2026

## Decision and actual state

The intended first-store-release scope is **South Korea (KR) and Argentina (AR)**.
The Portal draft was changed from KR/US/CA/AU/JP to KR/AR and independently read
back as **unverified** on November 1. Only `supported_countries` changed. GB/SG
were already absent. No review request, publication or runtime deployment was
performed by this country-setting update.

This is a reasoned operational classification of the current service, not a
regulator's ruling, legal certification or proof that every other country is
prohibited. The user authorized the widest supportable scope. The research
screened the markets below, including the EU common framework; it did not
complete an individual legal opinion for every country in the world. Unexamined
markets are not automatically cleared or permanently excluded.

A government response is **not** imposed as a prerequisite for KR/AR. This
supersedes the earlier conclusion that the Korean operator question had to remain
open until an FIU inquiry was answered. The inquiry remains unsent. TFH's
separate existing-contract review issue is not resolved by selecting countries.

## Facts on which this decision depends

- Users sign with their own wallets. The operator cannot access their keys,
  upgrade their vaults, change their fixed strategy or choose how to dispose of
  their funds. Each vault belongs to one owner, who chooses its heir and timer.
- New WLD/USDC deposits use the specified third-party Morpho strategy after risk
  and fee consent. The service receives 10% of realized positive gains, after
  strategy fees and loss recovery. This is a commercial service; lack of a
  separate transfer fee does not make it noncommercial.
- The named heir must file a claim after expiry. Seven days must then pass.
  Until settlement the owner can cancel by renewing. The public executor can
  only settle an eligible claim to the contract's then-fixed heir. It cannot
  invent a claim, alter the destination or withdraw the owner's active balance.
- The operator-funded relay uses that same public executor. Its gas spending
  and the gain fee do not themselves establish custody or discretion. The
  competing interpretation is that regular execution is transfer on behalf of
  another person; it must be assessed, not hidden behind the word noncustodial.
- The service does not take fiat deposits, issue its own investment token,
  promise principal/returns, sell a legal will, verify death or offer personal
  investment recommendations. Morpho shares nevertheless represent economic
  rights: absence of an Inheritance-issued token does not remove all possible
  financial-product or distribution questions.

These facts are implemented in `InheritanceVaultMorpho.sol`,
`InheritanceVaultUSDC.sol`, their factories and `backend/src/finalizer.mjs`.
The two factory `executeInheritance` functions are permissionless wrappers for
claim finalization, not general-purpose transfers. Third-party strategy
curator/governance powers are distinct from the operator's immutable vault powers.

## Included markets: basis and limits

### South Korea — include

The [current statutory definition](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1024562465)
and [current transfer decree](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=188933)
must be used. The decree is broader than the wording relied on by some 2021
staking interpretations; that old wording is not the basis for this decision.
The [FIU's August 2026 reporting manual](https://www.fsc.go.kr/no010101/87521)
assesses software/keyless wallets by their actual control and signing structure.
The [NeoFly interpretation](https://better.fsc.go.kr/fsc_new/replyCase/LawreqDetail.do?lawreqIdx=3828&muGpNo=75&muNo=171&stNo=11)
is supporting precedent for keyless software, not an approval of Morpho lending.

Our inference is that this fixed, nonexclusive execution mechanism is technical
implementation of owner/heir actions, rather than the operator taking control
of assets to provide a discretionary transfer/custody service. Lending decisions
and deposits are user-signed; the operator has no investment mandate or strategy
switch. The commercial fee is acknowledged, but does not independently identify
a regulated activity. On these concrete facts, proceeding on a non-reportable
software-service interpretation is reasonable. No FIU exemption or project-
specific government approval has been received. Reassess if keys, discretion,
upgrade powers, general transfer routing or the investment arrangement change.

### Argentina — include

[CNV RG 1172/2026, Chapter III Articles 1–4](https://www.argentina.gob.ar/normativa/nacional/norma-431259/texto)
provides exclusions for qualifying decentralized protocols and exclusively
self-custody software/hardware. They are conditional: a person controlling or
sufficiently influencing a protocol to perform PSAV services is not exempt merely
because contracts are public. Targeting local residents matters for covered
foreign providers; choosing Argentina is not reverse solicitation.

The inference here relies on the absence of operator asset disposition and on
nonexclusive deterministic execution, not on claiming that an identifiable UI
operator does not exist. The UI and profit fee are commercial, but do not confer
key custody, discretionary administration or a general transfer mandate. The
wallet-software clause alone is not treated as covering every lending feature;
the protocol's control/activity condition is assessed against the whole service.
This supports inclusion under the current no-control structure. No CNV ruling
on Inheritance or endorsement of the underlying Morpho shares is claimed. A
change in control, activity or financial-product classification reopens it.

## Closest additional candidates: not yet added

| Market | Positive evidence | Specific remaining distinction |
| --- | --- | --- |
| Peru (PE) | [SBS 2648-2024](https://intranet2.sbs.gob.pe/dv_int_cn/2424/v1.0/Adjuntos/2648-2024.R.pdf), Articles 1–2, applies the PSAV AML framework to locally domiciled/constituted providers, including registered foreign branches. The current operator is a Korean individual with no reported Peru establishment. | Territorial AML scope is not a complete product/marketing analysis. [SMV's official notice](https://www.smv.gob.pe/uploads/SobreAdquisicionTokens.pdf) identifies restrictions on public promotion of regulated financial rights/returns, including through foreign internet servers. Resolve whether the actual Morpho receipt-share route falls within those rights before adding the full product; do not infer a global crypto ban from that notice. |
| Panama (PA) | [SMV Opinion 04-2025](https://supervalores.gob.pa/opiniones/opiniones-2025/), conclusion on page 10, finds the described noncustodial BTC/ETH exchange-facilitation model outside its licensing regime. | The opinion is expressly tied to its facts and the non-financial-instrument analysis. WLD/USDC lending receipt shares and a gain-fee interface are not the model decided there. Classify those rights/distribution against the securities definitions used in the opinion; do not extend the BTC/ETH result automatically. |
| Austria / EU | [FMA guidance](https://www.fma.gv.at/en/investments/which-crypto-assets-and-services-are-regulated-and-which-are-not/) identifies generally unregulated lending/borrowing. [MiCA](https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32023R1114), recitals 22 and 94, addresses fully decentralized services without intermediaries and excludes lending/borrowing from MiCA itself. | That does not exempt an associated transfer/intermediary service or displace national financial-product law. The identifiable commercial UI plus funded settlement needs to satisfy the intermediary/activity boundary. A consumer explanation from Austria does not clear all 27 EU states. |
| Switzerland (CH) | [FINMA's fintech guidance](https://www.finma.ch/en/documentation/dossier/dossier-fintech/entwicklungen-im-bereich-fintech/) distinguishes wallets lacking disposal power. | [FINMA's DeFi assessment](https://www.finma.ch/en/documentation/dossier/dossier-fintech/decentralized-finance-defi/) applies substance over form to identifiable operators. Assess the complete lending-share/service arrangement, rather than relying on a wallet-only analogy. |

These are prioritized, bounded questions, not demands for regulator letters.
They are not promoted to launch markets by the absence of an enforcement case.

## Markets screened out of this release

“Not selected” below is a release decision, not a finding that every form of
noncustodial software is unlawful. Framework screening is shallower than the
KR/AR activity analysis and must not be represented as individual clearance.

| Market | Decision-relevant primary evidence and reason |
| --- | --- |
| United Kingdom (GB) | [FCA financial promotions](https://www.fca.org.uk/firms/cryptoassets/marketing-uk-consumers): overseas app/site promotion can require one of four lawful routes. No applicable route established for the current lending/rate presentation. |
| Singapore (SG) | [MAS's expanded payment-service scope](https://www.mas.gov.sg/news/media-releases/2024/mas-expands-scope-of-regulated-payment-services) expressly includes some nonpossessory token-transfer facilitation. A no-key argument alone cannot remove the settlement service from scope. |
| United States (US) | [FinCEN CVC guidance](https://www.fincen.gov/system/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf) separates software creation from operating transmission. Federal/state transfer and investment-product/distribution requirements are not resolved by self-custody. Remove the previous unassessed draft selection. |
| Canada (CA) | [FINTRAC scope](https://fintrac-canafe.canada.ca/msb-esm/msb-eng) includes virtual-currency transfer services and covered foreign businesses directing services at Canada. The funded relay requires an activity-specific conclusion. Remove the previous draft selection. |
| Australia (AU) | [AUSTRAC VASP scope](https://www.austrac.gov.au/industry-and-business/your-industry/virtual-asset-service-providers/virtual-asset-service-providers-overview) and [ASIC digital assets](https://www.asic.gov.au/regulatory-resources/digital-transformation/digital-assets-financial-products-and-services) raise separate transfer and financial-product tests for this gain-fee lending service. Remove the previous draft selection. |
| Japan (JP) | [FSA FAQ](https://www.fsa.go.jp/en/news/2018/20180717.html): cryptoasset and stablecoin intermediation require activity-specific treatment. USDC and the lending route prevent relying solely on a no-key wallet conclusion. Remove the previous draft selection; do not treat proposed/future provisions as already effective. |
| Uruguay (UY) | [BCU Circular 2507](https://www.bcu.gub.uy/Circulares/seggci2507.pdf), Article 127.22, expressly covers applicable direct-user smart-contract services; the software-development exclusion requires no active service provision. Our live UI/relay/fee arrangement is materially different. |
| Costa Rica (CR) | [Law 10961, June 19, 2026 Gazette](https://www.imprentanacional.go.cr/pub/2026/06/19/ALCA78_19_06_2026.pdf), Article 15 quater, establishes PSAV AML/registration duties and includes transfer/administration/financial-offer services. Its three-month commencement invalidates reliance on old “no regulation” summaries. |
| Guatemala (GT) | [Congress's Decree 15-2026 implementation report](https://www.congreso.gob.gt/noticias_congreso/16365/2026/4) records the new AML framework. Old central-bank crypto warnings alone cannot establish the current software-service scope; current activity/commencement rules need application. |
| Brazil (BR) | [BCB Resolution 520/2025](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=520&tipo=resolu%C3%A7%C3%A3o+bcb): provider/intermediary authorization framework; no current full-service exclusion established in this screening. |
| Mexico (MX) | [SAT virtual-asset guidance](https://www.sat.gob.mx/minisitio/ActividadesVulnerables/documentos/Formatos/Fraccion_XVI/folleto.pdf): AML scope can include foreign-provided services. Neither foreign hosting nor no fiat is sufficient. |
| Colombia (CO) | [UIAF Resolution 314/2021](https://www.uiaf.gov.co/resolucion-314-de-2021): reporting obligations exist despite the absence of a single comprehensive crypto law. Full transfer/service attribution remains to be applied. |
| Chile (CL) | [CMF fintech rules](https://www.cmfchile.cl/portal/prensa/625/w4-article-77135.html): advice, financial instruments and order-routing services have distinct requirements. No automatic equivalence between lending software and a covered trading venue is asserted; full-service treatment remains unestablished. |
| New Zealand (NZ) | [DIA July 2026 territorial guidance](https://www.dia.govt.nz/diawebsite.nsf/Files/AML-CFT-2026/$file/AML-CFT-Guidance-Territorial-Scope-of-the-AMLCFT-Act-July-2026.pdf): mere web accessibility differs from directed service/repeated local business. A deliberately selected store market cannot rely only on no local office. [FMA financial-product scope](https://www.fma.govt.nz/business/services/cryptocurrencies/) remains relevant to shares. |
| Hong Kong (HK) | [SFC DeFi guidance](https://www.sfc.hk/-/media/EN/files/COM/Speech/Web3-Festival_Eng_20230412.pdf?hash=58C08F1AB276D03628BC5DA60B1292FA&rev=a837fed76ffc438db98ce61151d8166a): decentralization terminology does not displace regulated activities/collective-investment analysis. |
| Taiwan (TW) | [FSC VASP AML rules](https://law.fsc.gov.tw/LawContent.aspx?id=GL004000): transfer and asset-control services need classification. Proposed technical-provider exclusions are not treated as enacted exemptions. |
| India (IN) | [FIU January 2026 VDA guidelines](https://fiuindia.gov.in/pdfs/downloads/VDA08012026.pdf): current service-provider AML scope needs applying to the whole interface/relay; no positive software-only determination completed. |
| Thailand (TH) | [SEC deposit/lending restrictions](https://www.sec.or.th/TH/Pages/News_Detail.aspx?Lang=TH&NewsNo=111&NewsYear=2566&SECID=10018) make the lending feature important. The rules for covered operators are not described as a ban on every software tool. |
| Indonesia (ID) | [OJK POJK 27/2024](https://ojk.go.id/id/regulasi/Pages/POJK-27-2024-AKD-AK.aspx) and its amendments regulate digital-asset activity. No complete interface/lending exclusion established. |
| Vietnam (VN) | [Resolution 05/2025 pilot](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-5-2025-nq-cp-ve-trien-khai-thi-diem-thi-truong-tai-san-ma-hoa-tai-viet-nam-119250909184045221.htm): a controlled market pilot is not general permission for an overseas lending app. |
| Malaysia (MY) | [SC digital-asset framework](https://www.sc.com.my/digital-assets): trading, offering and custody have distinct rules. Screening did not determine the full receipt-share interface outside them. |
| Georgia (GE) | [NBG VASP FAQ](https://nbg.gov.ge/en/faq/125): registration framework exists. No project-specific territorial/activity exclusion established by this screening. |
| Mauritius (MU) | [VAITOS Act](https://www.fscmauritius.org/media/119928/the-virtual-asset-and-initial-token-offering-services-act.pdf): software/noncustodial exclusions require checking the actual business/facilitation conditions. A full foreign-service analysis was not completed. |
| Kenya (KE) | [CBK notice on VASP Act 2025](https://www.centralbank.go.ke/uploads/press_releases/665231223_Public%20Notice%20on%20the%20Virtual%20Assets%20Service%20Providers%20Act%202025.pdf): new framework; no full-service software determination completed. |
| South Africa (ZA) | [FSCA CASP update](https://www.fsca.co.za/News%20Documents/FSCA%20Press%20Release%20-%20FSCA%20update%20on%20Crypto%20Asset%20Service%20Providers%2012%20December%202024.pdf): licensing/intermediary treatment must be evaluated rather than assuming no keys resolves it. |

The Philippines, UAE, Bahrain and Dominican Republic were source-discovery
checks only, not completed full-service assessments. Paraguay and Nigeria searches
did not establish adequate primary-source coverage. They remain unassessed, not
classified prohibited. EU-wide screening does not cover EEA implementation dates
or every member state's residual law. No unsupported “all countries reviewed”
count is used.

## Store selection, access and remaining release work

The Portal setting controls store availability; it does **not** geoblock the
public website, deep links or immutable contracts. This change does not claim
that access is restricted to KR/AR. Existing owners/heirs retain fund access.
Before representing an actual launch as territorially restricted, implement and
verify the necessary onboarding/new-deposit restrictions, including treatment of
unknown locations; preserve withdrawal, renewal and existing-claim access. An IP
check cannot establish residence or make immutable contracts inaccessible.

The original October 21 rejection concerned UI/UX and distinct tabs, not a
country/contract rejection. The [official submission guide](https://docs.world.org/mini-apps/quick-start/app-store)
identifies the Portal and a post-rejection contact route. The separate
[contract guidelines](https://docs.world.org/mini-apps/guidelines/smart-contract-development-guidelines)
require pre-deployment repository sharing and agreement on documented fees during
code review. The historical sharing step remains unverified; the approved
October 25 email has no reply in the last November 1 check. No new outreach was
sent, and no universal legal certificate, paid audit or fresh deployment is
invented as mandatory. Resubmission remains pending substantive readiness, not
an FIU letter or validation in every unselected country.
