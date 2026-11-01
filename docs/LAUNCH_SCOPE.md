# Launch scope — November 2, 2026

## Current release — Korea-only verified and ready for review

The operator selected **South Korea (KR) only** on November 2. The 01:52 KST
KR/AR/CO submission was withdrawn for this scope change. Independent Portal
readback confirms **unverified**, exactly **KR**, with only availability copy
and supported countries changed. Developer allowlisting remains enabled.

Runtime `afd5bab` limits new plans and deposits to KR residence and KR network
location. Prior AR/CO residence records cannot authorize new requests. Existing
balances, withdrawals, renewals, claims and submitted-transaction recovery remain
accessible outside KR. Local eligibility (11 tests), WebKit (21 checks / 31
layouts), translation, type, lint and build checks passed; independent commit
review found no actionable defect. Production `4a35244` was deployed and independently checked; actual Android
Korea-only acceptance passed. Native policy run 41329500340 passed two tests
with no failures, including all five traced Done gestures without extra clicks.
The new submission receipt is recorded in RELEASE.md after Portal readback.

The keyboard cause and fix remain established by the before/after native trace:
see [KEYBOARD_DISMISSAL.md](KEYBOARD_DISMISSAL.md). The previous three-country
submission receipts below are historical and no longer the active request.

## Decision and actual state

The intended first-store-release scope is **South Korea (KR) only**. The operator
explicitly narrowed the launch on November 2 to reduce the initial operational
scope. Argentina and Colombia are deferred by that choice; this does not reverse
the prior country assessment or declare the product prohibited there. The
country-specific analysis below is retained for future decisions, not permission
to re-enable those markets without authorization.

The Portal draft is now unverified with exactly KR. Runtime `afd5bab` applies the
same scope to new vault/deposit requests. Production and Android verification
passed; exact receipts are recorded in [RELEASE.md](RELEASE.md). Earlier KR/AR/CO submissions are withdrawn.

This completes the release-selection assessment of the candidates named below,
replacing the earlier framework-only screening. It is a reasoned operational
judgment about the **current complete product**, not a regulator ruling or a
worldwide legal opinion. A non-selection is not a declaration that all software
is prohibited there. Material statutory overlap can justify not launching this
product without proving that enforcement is certain; mere existence of a VASP
regime or absence of a project-specific government letter cannot.

The common EU transfer-services question supports the same release decision for
its 27 member states; this is not 27 separate opinions on residual national law.
Countries outside this explicit candidate set have not been certified or declared
prohibited. New searches with no change to facts/law are not a prerequisite for
submitting the selected scope.

A government response is **not** imposed as a prerequisite for the selected scope. This
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

## Selected and previously assessed markets: basis and limits

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

### Argentina — previously assessed; deferred by operator

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

### Colombia — previously assessed; deferred by operator

[UIAF's official FAQ, section 5.1 footnote 16](https://uiaf.gov.co/sites/default/files/inline-images/Preguntas_Frecuentes_PSAV.pdf)
identifies providers domiciled in Colombia as reporting subjects. Its
[current register](https://www.uiaf.gov.co/node/1781) still lists Resolution
314/2021 as in force. The Korean individual operator has no reported Colombian
establishment. This territorial conclusion does not depend on pretending that
the funded relay could never be a transfer service.

The SFC's [June 2026 explanation](https://www.superfinanciera.gov.co/publicaciones/10115324/que-son-los-activos-digitales-o-criptoactivos/)
and [September 2026 innovation FAQ](https://www.superfinanciera.gov.co/publicaciones/10103299/innovasfcelhub-10103299/)
distinguish ordinary crypto services from regulated financial/public-fund-raising
business. Its [token interpretation](https://www.superfinanciera.gov.co/publicaciones/10109732/normativanormativa-generalboletin-juridico-superintendencia-financieraboletin-juridico-numero-otros-conceptos-sintesis-10109732/)
also cautions against automatically treating every economically negotiable token
as a recognized security.

**Application/inference:** Inheritance neither receives public money into an
operator-controlled pool nor issues a repayment promise, investment mandate or
participation in its business. Users retain their individual vault claims and
choose transactions into an external protocol; the gain fee buys software/
execution service, not an operator-managed investment. Morpho shares and curator
powers were considered: they are not silently equated with ordinary WLD, but the
review found no basis to treat this interface as offering a Colombian recognized
security or operating a local collective fund. This supports inclusion under the
current facts, rather than an assumption that all yield is exempt. Reopen for a
Colombian establishment, operator asset control, new investment obligations, or a
material token-classification change. No SFC endorsement is claimed.

**World host and privacy cross-check:** SIC confirmed the shutdown of World
Foundation/TFH's sensitive-data operation in Resolution 45710 (June 18, 2026).
Its [July 8 statement](https://sedeelectronica.sic.gov.co/international-relations/sic-confirms-immediate-and-permanent-shutdown-sensitive-data-processing-operation-carried-out-world-foundation-and-tools)
was unavailable directly (HTTP 403); the [attributed reproduction](https://provimarcas.com/en/the-sic-confirms-the-immediate-and-permanent-shutdown-of-the-sensitive-data-processing-operation-carried-out-by-world-foundation-and-tools-for-humanity-corporation-in-colombian-territory/)
describes the Orb/World ID biometric operation, erasure obligations, and Colombian
privacy law's application to foreign processors. This is not merely an Orb
hardware restriction. Conversely, World’s [current wallet help](https://support.world.org/hc/en-us/articles/44413326159635-What-is-a-Virtual-Account)
explicitly lists Colombian wallet funding/withdrawal support through Ripio.
That is provider availability information, not proof of regulatory clearance.
Inheritance's current login uses `MiniKit.walletAuth`; it neither requests World
ID verification nor collects iris data. **Inference:** the available evidence
does not establish a prohibition on this independent, non-biometric mini app,
so CO remains selected. No local-device availability test or full appellate
decision review is claimed. Do not require biometric enrollment for this release;
reassess if the host makes it necessary or restricts Colombian Mini Apps.
Ordinary personal-data obligations still apply: UIAF's domicile boundary is not
a privacy-law exemption, and this review does not certify TFH's compliance.

## Close candidates: completed assessment, not selected for this product

### Australia — do not add; payment-facility issue remains material

The earlier AUSTRAC-only reason was insufficient. AUSTRAC's
[geographical-link guidance](https://www.austrac.gov.au/new-austrac/geographical-link-requirement)
does not automatically cover a Korean provider merely because Australians use
its website; no Australian permanent establishment is reported. The Federal
Court's [Access analysis, paragraphs 74–79](https://download.asic.gov.au/media/ebepd0u0/24-019mr-asic-v-web3-ventures-pty-ltd-2024-fca-judgment.pdf)
also supports distinguishing a DeFi connection service from an operator-managed
investment. The [2026 High Court Earner decision](https://www.hcourt.gov.au/cases-and-judgments/judgments/judgments-1998-current/australian-securities-and-investments-commission-v-web3-ventures-pty-ltd)
concerns the separate fixed-return product; the reversed Earner appeal is not
relied on as clearance.

The decisive counterpoint is [ASIC's non-cash-payment-facility analysis](https://www.asic.gov.au/regulatory-resources/digital-transformation/digital-assets-financial-products-and-services).
It expressly reaches some noncustodial wallets. Our marketed purpose includes
payment to an heir, and the deployed factory also permits owner-authorized
withdrawals to a supplied address (`withdrawFromMyVault`, `withdrawAllFromMyVault`,
and `withdrawSharesFromMyVault`). Thus the single-payee exclusion cannot be
assumed from one currently named heir. Payment is a core purpose, weakening the
incidental-product exclusion. [Instrument 2026/167](https://www.legislation.gov.au/F2026L00318/asmade/2026-03-24/text/original/epub/OEBPS/document_1/document_1.html)
does not fix this: there is no enforced AUD1,000 per-client/AUD10m aggregate cap,
and this reloadable yield vault is not a non-reloadable gift facility.
**Decision:** do not launch the current unrestricted facility in AU. This is an
activity-based judgment, not a finding that all DeFi connectors need a licence.

### Switzerland — do not add the current retail yield route

[FINMA's keyless-wallet guidance](https://www.finma.ch/en/documentation/dossier/dossier-fintech/entwicklungen-im-bereich-fintech/)
supports no AML custody/disposal attribution. An identifiable developer or a fee
alone does not establish protocol control. The detailed
[Swiss Blockchain Federation DeFi paper, pages 16–18](https://blockchainfederation.ch/wp-content/uploads/2025/11/20250318-SBF-Circular-DeFi-final_EN.pdf)
supports that distinction, but explicitly preserves the separate treatment of
financial-instrument offerings through a frontend. It is expert analysis, not a
FINMA ruling.

Our separate owner vaults feed a pooled, curated external strategy and expose
redeemable proportional return claims. User custody of the receipt does not give
day-to-day control over the external portfolio. That is a concrete collective-
investment/retail-offer issue, beyond the favorable software-control analysis.
[FINMA requires approval for foreign collective schemes offered to non-qualified
investors](https://www.finma.ch/en/authorisation/asset-management/foreign-collective-investment-schemes/).
**Decision:** exclude this retail yield offering absent a supported distribution
route or a materially different product. Do not call every immutable contract a
fund or assert that FINMA has classified these specific Morpho shares.

### Peru, Panama and Dominican Republic — do not add the yield-share offering

| Market | Favorable case considered | Application and release decision |
| --- | --- | --- |
| Peru (PE) | [SBS 2648-2024, Articles 1–2](https://intranet2.sbs.gob.pe/dv_int_cn/2424/v1.0/Adjuntos/2648-2024.R.pdf) targets local providers/branches; the Korean operator has no reported local establishment. | [Securities law Articles 2–4](https://www.smv.gob.pe/ServicioDifusionEmpresas/uploads/TUO_LMV_DECRETO_SUPREMO_N_020_2023_EF.pdf) tests mass-issued negotiable economic rights and public invitations, including offers by non-issuers. Fungible redeemable Morpho shares and the public deposit invitation materially engage that test. [SMV's token notice](https://www.smv.gob.pe/uploads/SobreAdquisicionTokens.pdf) addresses foreign internet promotion too. Do not select the full yield route on an AML territorial exemption alone. |
| Panama (PA) | [SMV Opinion 04-2025, page 10](https://supervalores.gob.pa/opiniones/opiniones-2025/) accepts its described noncustodial BTC/ETH exchange facilitator outside the licensing perimeter. | That determination depends on the assets not being financial instruments. Our external pool's redeemable return shares are materially different from the opinion's underlying BTC/ETH case. The quoted financial-instrument test concerns economic asset/claim rights, not only key possession. Do not extend that fact-specific opinion to public distribution of the current return-bearing route. This is a product classification judgment, not a claim that Panama bans crypto software. |
| Dominican Republic (DO) | SIMV's [2023 report, Circular 04/23 summary](https://simv.gob.do/wp-content/uploads/2024/06/Informe-Anual-Desempeno-del-Mercado-de-Valores-2023.pdf) reports no general crypto-offering regime; the central-bank warning is not a ban on individuals. | [SIMV's current definitions](https://simv.gob.do/preguntas-frecuentes/) cover economic rights and fund participation, and [public offer](https://simv.gob.do/glossary/oferta-publica/) includes indirect invitations. The proportional pooled-return receipt and its active offering are the material distinction. Do not select this product based only on the older ordinary-crypto warning; no blanket prohibition is asserted. |

### EU — do not add the current combined service

[MiCA recitals 22 and 94 and Articles 3/59](https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32023R1114)
distinguish fully decentralized services without intermediaries, lending, and
regulated transfer services. [ESMA Q&A 2883, June 2026](https://www.esma.europa.eu/publications-data/questions-answers/2883)
confirms lending is not itself a MiCA service; associated CASP duties and possible
collective-investment treatment remain. It does not prohibit every gain fee.
The [transfer regulation's recital 21](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX%3A32023R1113)
distinguishes ancillary infrastructure from persons actually performing transfers.

The favorable argument is that our executor is public and deterministic. The
countervailing fact is that the commercial operator promises and funds ongoing
settlement, including redemption of investment shares, as part of the service.
The operator is not merely publishing code or displaying a link. We judge the
combined activity too close to transfer-on-behalf/intermediation to market to EU
retail clients as an exempt service. [Austria's unregulated-lending explanation](https://www.fma.gv.at/en/investments/which-crypto-assets-and-services-are-regulated-and-which-are-not/)
does not remove that separate activity. **Decision:** no EU member state added
for this product; no separate national-law problem needs to be invented to reach
that common-framework decision. This is not a definitive court classification.

## Other candidates: specific release decisions

All rows below are **not selected for the current product**. The column applies
the relevant activity or offering rule to our facts; it does not claim that a
regime's existence automatically regulates every software developer. Where the
boundary is interpretive, the decision is the operator's release judgment.

| Market | Rule applied to this service and why the favorable argument does not carry the full product |
| --- | --- |
| United Kingdom (GB) | [FCA financial-promotion routes](https://www.fca.org.uk/firms/cryptoassets/marketing-uk-consumers) cover overseas invitations to UK consumers. The app/store presents rates and solicits a deposit; no lawful promotion route is in place. Key custody is not the promotion test. |
| Singapore (SG) | [MAS's expanded scope](https://www.mas.gov.sg/news/media-releases/2024/mas-expands-scope-of-regulated-payment-services) expressly includes token-transfer facilitation without possession. The commercial funded settlement is a closer match than a passive code publisher. No-key possession does not resolve it. |
| United States (US) | The [SEC's April 2026 interface staff statement](https://www.sec.gov/newsroom/speeches-statements/staff-statement-regarding-broker-dealer-registration-certain-user-interfaces-utilized-prepare-staff-statement-regarding-broker-dealer-registration-certain-user-interfaces-utilized) is favorable to user-directed code preparation and permits objective user-paid percentage fees. However, it excludes execution/settlement beyond that role and imposes neutral/customizable-route and disclosure conditions. Our fixed yield route plus service-run settlement does not fit that whole fact pattern. It also does not clear product offerings or state law. Do not claim the fee alone defeats the relief or the statement itself makes our service unlawful. |
| Canada (CA) | [FINTRAC](https://fintrac-canafe.canada.ca/msb-esm/msb-eng) includes VC transfer services and foreign providers directing covered services to Canadians. The operator actually submits eligible beneficiary transfers; it is more than an unhosted-wallet developer. [The identity rules](https://fintrac-canafe.canada.ca/guidance-directives/client-clientele/client/msb-eng.php) distinguish requests to transfer and remittance to beneficiaries, without a general key-possession exemption. Do not target Canada on the software-only interpretation used in KR. |
| Japan (JP) | [FSA's current intermediary guidance and reform record](https://www.fsa.go.jp/recent/recent2026.html) distinguishes crypto and electronic-payment-token services from simple wallet software. USDC and subscription/redemption into return shares make this a token/financial-right intermediary question, not just custody. No affiliated registered intermediary or approved distribution route exists for this product. Future commencement provisions are not treated as already effective. |
| Uruguay (UY) | [BCU Circular 2507, Article 127.22](https://www.bcu.gub.uy/Circulares/seggci2507.pdf) expressly addresses direct-user smart-contract services; the software-development exclusion requires no active service provision. Our maintained retail UI, gain fee and funded settlement do not remain at that development-only boundary. |
| Costa Rica (CR) | [Law 10961, Article 15 quater](https://www.imprentanacional.go.cr/pub/2026/06/19/ALCA78_19_06_2026.pdf) adds transfer/administration/financial-offer PSAV duties, effective three months after publication. Commercial beneficiary execution is the relevant transfer activity, even without a separate transfer fee. The old absence-of-regulation argument is unavailable. |
| Guatemala (GT) | [Decree 15-2026 entered force September 17](https://www.congreso.gob.gt/noticias_congreso/17000/2025/) and includes virtual-asset service providers. Commercial client-facing transfer execution is not safely classified by the old crypto-warning regime. Do not use unfinished implementing mechanics as permission to launch; this is a conservative application of the new service perimeter, not a definitive finding on every technical relayer. |
| Brazil (BR) | [BCB Resolution 520, current September 2026 version](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=520&tipo=resolu%C3%A7%C3%A3o+bcb) regulates intermediation and provides a transition for foreign operators' local operations/customers. Local-company requirements are not a general overseas-website exemption. Subscription/redemption into the fixed external strategy plus funded transfers is commercially active intermediation, not only wallet manufacture. No applicable authorized/local successor route is in place. |
| Mexico (MX) | [SAT's Article 17(XVI) guidance](https://www.sat.gob.mx/minisitio/ActividadesVulnerables/documentos/Formatos/Fraccion_XVI/folleto.pdf) addresses professionally operated electronic facilities facilitating covered virtual-asset transactions. Our repeat deposits for receipt shares, redemption and settlement are not mere possession for personal use. Do not assume no fiat or offshore hosting removes the full service; without the corresponding operator AML arrangements, do not select MX. |
| Chile (CL) | [Law 21521, Articles 3/5](https://www.bcn.cl/leychile/navegar?idNorma=1187323) uses broad financial-instrument and regulated-service definitions. [CMF's 2026 interpretations](https://www.cmfchile.cl/institucional/inc/dictamenes.php?aa=2026), including Ord. 59685, distinguish executing contribution/redemption instructions from advice alone. Our yield subscription/exit flow has that material overlap. This is not an assertion that every direct smart-contract call is an order to a regulated exchange; do not market this complete retail service without an appropriate route. |
| New Zealand (NZ) | [DIA's VASP guideline, page 10](https://www.dia.govt.nz/diawebsite.nsf/Files/AML-CFT-2023/$file/AML-CFT-VASP-Guideline.pdf) distinguishes storage-only wallets from transfer/arranging transactions. We run the latter settlement activity. [July 2026 territorial guidance](https://www.dia.govt.nz/diawebsite.nsf/Files/AML-CFT-2026/$file/AML-CFT-Guidance-Territorial-Scope-of-the-AMLCFT-Act-July-2026.pdf) distinguishes mere accessibility from directed/repeated NZ business; selecting the store market cannot rely only on no office. |
| Hong Kong (HK) | [SFC's DeFi analysis](https://www.sfc.hk/-/media/EN/files/COM/Speech/Web3-Festival_Eng_20230412.pdf?hash=846D1DBC314AD1D301062536597CC1DB&rev=0ab8a6ab26814580a5ef1d2c29317673) specifically identifies public marketing of qualifying liquidity pools as a CIS issue. The external curated pool and return shares, rather than our keyless owner vault alone, make this a concrete retail-offer concern. No applicable authorized retail scheme/distribution route is established. |
| Taiwan (TW) | [Current VASP registration rules, Articles 2/3/5](https://law.fsc.gov.tw/LawContent.aspx?id=GL004000) separately regulate transfer providers and require overseas providers' local company/branch registration. Our repeated paid-service settlement matches the transfer concern; no keys is relevant to custody but not a complete response. Proposed technical-provider exceptions are not enacted exemptions. |
| India (IN) | [FIU's January 8, 2026 guidelines, sections 1.2/1.4/2.1](https://fiuindia.gov.in/pdfs/downloads/VDA08012026.pdf) include business transfers on behalf of others and expressly apply irrespective of physical presence. The funded settlement is the material activity; sections 7.1/7.2 also reject automatic smart-contract/unhosted-wallet immunity. Do not select without an applicable non-provider basis or registration/compliance route. We do not claim every smart-contract developer is a reporting entity. |
| Thailand (TH) | [SEC's effective 2023 rule](https://www.sec.or.th/EN/Pages/News_Detail.aspx?SECID=10018), paragraph 2.3, reaches covered digital-asset businesses supporting others' deposit/lending services, not just taking deposits themselves. The advertised Morpho-deposit route is support for such a service; it cannot be cleared merely because our operator never borrows the funds. Do not describe this as a ban on all code or all private crypto lending. |
| Indonesia (ID) | [POJK 27/2024](https://ojk.go.id/id/regulasi/Pages/POJK-27-2024-AKD-AK/) and [2025 implementing AML rules](https://www.ojk.go.id/id/regulasi/Documents/Pages/SEOJK-16-SEOJK07-2025-Penerapan-Program-APU-PPT-dan-Pencegahan-Pendanaan-Proliferasi-Senjata-Pemusnah-Massal-Pedagang-AKD/SEOJK%2016-SEOJK07-2025%20Penerapan%20Program%20APU%20PPT%20dan%20Pencegahan%20Pendanaan%20Proliferasi%20Senjata%20Pemusnah%20Massal%20bagi%20Pedagang%20AKD.pdf) include digital-asset dealing that facilitates customers. This product actively enables obtaining/redeeming external return shares rather than solely displaying balances. Do not select the offshore retail yield interface on a bare noncustody argument; no compliant local service route is in place. |
| Vietnam (VN) | [Resolution 05/2025](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-5-2025-nq-cp-ve-trien-khai-thi-diem-thi-truong-tai-san-ma-hoa-tai-viet-nam-119250909184045221.htm) provides a licensed pilot with specific provider/asset conditions. The current WLD/USDC external-share service is not admitted through that route. Do not infer a permissionless overseas retail-offering exemption from the existence of a pilot. |
| Malaysia (MY) | [The digital-token prescription, paragraph 3(2)](https://www.sc.com.my/api/documentms/download.ashx?id=8c8bc467-c750-466e-9a86-98c12fec4a77) specifically tests contribution, pooling, asset-generated return, expectation of return and absence of day-to-day control. The external strategy shares materially match these features even though each inheritance wrapper has one owner. No own token and no operator keys do not resolve offering that instrument. |
| Georgia (GE) | [NBG's VASP FAQ](https://nbg.gov.ge/en/faq/125) lists transfer and convertible-VA lending for another's benefit separately from safekeeping. Regular operator-funded settlement and the lending route engage that service test; the operator is not simply a self-directed holder. The registration-free wallet-only case is not a sufficient basis for deliberately marketing this combined service. |
| Mauritius (MU) | [Consolidated VAITOS Act, sections 3(2)(e) and 34A](https://lawsofmauritius.govmu.org/portal/viewlegislationdocument/web/?docnumber=&doctitle=VmlydHVhbCBBc3NldCBhbmQgSW5pdGlhbCBUb2tlbiBPZmZlcmluZyBTZXJ2aWNlcyBBY3Qg%0D%0AMjAyMQ%3D%3D&doctype=act) resolves the earlier open question. The ancillary-services exclusion is services **to a VASP**, not an unrestricted retail frontend exemption. Section 34A, effective August 13, 2026, requires licensing for covered solicitation/access facilitation to local investors and expressly addresses websites/apps. Our intended retail promotion is directly relevant. Do not rely on the original 2021 Act alone. |
| Kenya (KE) | [Enacted Act 20/2025](https://new.kenyalaw.org/akn/ke/act/2025/20/eng%402025-11-04/source), sections 4/8 and First Schedule (official Gazette [mirror](https://bitcoinke.io/wp-content/uploads/2025/10/The-Virtual-Asset-Service-Providers-Act-2025-BitKE.pdf)), distinguishes custodial wallets from payment processors arranging transactions between virtual assets. Our client-facing settlement/subscription service presents the latter issue. The closed-ecosystem exclusions do not fit transferable WLD/USDC and shares. No licence is held; this new launch does not rely on a transition for existing operators. |
| South Africa (ZA) | [FSCA's CASP guidance](https://www.fsca.co.za/News%20Documents/FSCA%20Press%20Release%20-%20FSCA%20update%20on%20Crypto%20Asset%20Service%20Providers%2012%20December%202024.pdf) applies the FAIS financial-product/intermediary framework. The product helps clients acquire and redeem return-bearing positions and carries out settlement, beyond factual education. The absence of personalized advice does not remove intermediary activity. Do not select without the relevant licensed-service basis. |
| Philippines (PH) | [SEC MC 4/2025](https://www.sec.gov.ph/mc-2025/sec-mc-no-04-series-of-2025the-sec-rules-on-crypto-asset-service-providers-sec-casp-rules/), sections 2/5/7 (official signed document [mirror](https://babylon2k.org/wp-content/uploads/2025/06/2025-SEC-MC-No.-4-S.-of-2025-The-SEC-Rules-on-Crypto-Asset-Service-Providers-SEC-CASP-Rules-2-1.pdf)), separately covers public offerings and marketing, including third-party marketers. Our rate/deposit presentation is not purely educational or a consumptive token. No local licensed CASP/authorized marketing relationship exists; old wallet exceptions do not clear that promotion. |
| UAE (AE) | [VARA's 2024 Marketing Regulations, I.B](https://rulebooks.vara.ae/sites/default/files/en_net_file_store/VARA_EN_419_VER1.pdf) and [current guidance](https://rulebooks.vara.ae/rulebook/i-guidance-topic) address targeting the UAE and deem it to target Dubai. Regulated activity marketing must be by/on behalf of the licensed VASP. Our lending/settlement solicitation has no such route. Country-wide selection cannot be justified by another free zone's different framework. |
| Bahrain (BH) | [CBB CRA-1.1](https://www.cbb.gov.bh/wp-content/uploads/2022/08/Vol-6-CRA.pdf) covers commercial marketing/solicitation and treats directly soliciting local clients as within/from Bahrain. Our subscription interface is materially closer to an active service offer than passive code publication. There is no licensed service/distribution arrangement; no local office is not a sufficient territorial argument. |
| Paraguay (PY) | [SEPRELAD Resolution 008/2020, Articles 1–2](https://www.seprelad.gov.py/userfiles/files/resoluciones/resolucion-seprelad-n-008-2020-1.pdf) includes transfer and related financial services, and even mining/equivalents. The funded client-facing execution is a transfer-service concern; calling it mining would not establish an exclusion. Do not select on a developer/no-fiat analogy without the corresponding reporting basis. This is not a finding that the resolution expressly settles every foreign passive website. |
| Nigeria (NG) | [SEC rules, Part D 1.1](https://sec.gov.ng/wp-content/uploads/2022/05/Rules-on-Issuance-Offering-and-Custody-of-Digital-Assets.pdf) expressly includes transfer-facilitating platforms and foreign operators actively targeting Nigerians. The infrastructure-only exception is materially different from our retail subscription and executed settlement service. [The 2026 capital framework](https://home.sec.gov.ng/for-investors/keep-track-of-circulars/revised-minimum-capital-mc-for-regulated-capital-market-entities/) also addresses ancillary VASPs; the 2024 exposure draft is not treated as enacted law. No applicable registered route exists. |

## What would change the country decisions

The material recurring constraint is **the combined commercial product**:
external curated yield/share distribution, operator-run settlement, and active
retail promotion. It is not simply “crypto is regulated.” Removing the yield
route could eliminate several financial-product questions, but would not remove
AU's payment-facility issue or every transfer/marketing rule. Disabling the
operator relay would address a different subset and would change the service
promise. Neither change is a cosmetic disclaimer, and neither was made during
this review. Keeping the approved product and selecting KR only is the current release
choice. Re-enabling previously assessed AR/CO requires a new operator decision;
other broader access needs a separately evaluated product or licensed route,
not repeated speculative searches or a universal government letter.

## Store selection, access and remaining release work

The Portal setting controls store availability. The official interface now
checks Cloudflare's request-country metadata plus a separately confirmed,
wallet-specific residence choice before requesting a new vault or deposit.
Both must be KR. Stored AR/CO confirmations are rejected for new requests. Unknown locations, outages and unsupported countries
fail closed for new requests. Each new wallet request checks the edge again;
a display snapshot never authorizes it. Residence is not preselected, and can
be changed from Help. The endpoint stores neither IPs nor eligibility records;
residence confirmation stays on the device.

Sign-in, existing balances, withdrawals, renewals, settings, claims, rewards
already owed and recovery of prior submissions remain available. This is an
official-interface restriction, not a block on direct immutable-contract calls,
a residence verification service or reliable VPN detection. Source/test entry
points are `app/functions/api/eligibility.ts`, `app/shared/new-plan-policy.ts`,
`app/src/new-plan-eligibility.ts`, `scripts/test-eligibility.mjs` and the existing
product/WebKit suites. Region fixtures are limited to isolated test hosts.

The original October 21 rejection concerned UI/UX and distinct tabs, not a
country/contract rejection. The [official submission guide](https://docs.world.org/mini-apps/quick-start/app-store)
identifies the Portal and a post-rejection contact route. The separate
[contract guidelines](https://docs.world.org/mini-apps/guidelines/smart-contract-development-guidelines)
require pre-deployment repository sharing and agreement on documented fees during
code review. The historical sharing step remains unverified; the approved
October 25 email has no reply in the last November 1 check. No new outreach was
sent, and no universal legal certificate, paid audit or fresh deployment is
invented as mandatory. Verified preparation led to the November 2 resubmission;
an FIU letter or further research into every unselected country was not required.

The subsequent November 1 instruction authorizes submission **after preparation
is complete**, with existing-source/fee review requested through the official
Portal. The user declined another support email. The Portal request must disclose
the unverified sharing history and ask TFH to specify any separate intake or
remediation step; source availability is not prior acceptance. This replaces
waiting indefinitely for an unanswered support email as a prerequisite to asking
for that review. It does not declare the historical requirement satisfied.
