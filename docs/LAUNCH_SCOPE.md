# Launch scope assessment — October 24, 2026

Operator-reported operating country: Korea. Individual/company status and legal
entity name have not been supplied. Portal countries remain KR, US, GB, CA, AU,
JP and SG. Operating location does not establish permission to serve every
distribution country. This is a source-based issue assessment, not legal clearance.

## What the product actually does

- Users sign using their own World App wallet. The service never receives their
  private keys. User vaults have no developer upgrade or asset-redirection power.
- New WLD and USDC deposits route into fixed Morpho strategies after consent.
  The service earns 10% of realized positive gains, separately from strategy fees.
- The user specifies a recipient and timer. That recipient can claim after
  expiry; after the review window anyone can relay settlement to the fixed recipient.
  The operator runs a paid-gas relay, with no ability to change who receives funds.
- The app does not establish death, legal heirship or a legally valid will.

These facts, including the fee and relay, must all be considered. Describing the
service as noncustodial alone does not decide its legal classification.

## Specific questions supported by primary sources

| Scope | Source and finding | Application to this release |
| --- | --- | --- |
| World review policy | [App Review Guidelines](https://docs.world.org/mini-apps/guidelines/policy) place jurisdictional compliance on the app and require it before submission. They do not specify a universal legal-opinion attachment. | Distinguish required compliance from optional evidence formats. |
| Korea | [FSC interpretation of December 23, 2021](https://better.fsc.go.kr/fsc_new/replyCase/LawreqDetail.do?lawreqIdx=3828&muGpNo=75&muNo=171&stNo=11) addresses a wallet without operator key control and a particular staking arrangement. It discusses exclusions and expressly notes potential future regulation. | Supports examining the absence of key control. It is an older, fact-specific interpretation, not a determination covering this app's lending routes, fee and automated transfer service today. Obtain a current determination of the applicable reporting/licensing obligations for those facts. |
| United Kingdom | [FCA cryptoasset marketing guidance](https://www.fca.org.uk/firms/cryptoassets/marketing-uk-consumers), updated February 6, 2026, applies the promotion regime to overseas businesses and includes mobile apps and websites. It identifies four lawful communication routes. | Determine whether the app's lending/returns presentation is a qualifying promotion and, if so, which lawful route applies. No evidence of an applicable route has been supplied. A disclaimer alone does not resolve this question. |
| US, CA, AU, JP, SG | No country-specific assessment has been completed in this follow-up. | Do not infer clearance from Portal selection or the operator's Korean location. |

Before changing distribution, decide the intended launch countries and resolve
the applicable obligations there. Restricting the store listing does not by itself
restrict the public website; any required access restrictions need matching runtime
behavior and must preserve existing holders' access to their funds. No distribution
or access restriction has been silently applied by this assessment.

## Questions ready for an operator or qualified adviser

1. What is the operating entity and its individual/company registration status?
2. Which countries will actually be served at launch?
3. Under current Korean law, do the fixed lending integrations, realized-gain fee
   and automatic fixed-recipient relay require registration or other controls?
4. If UK distribution remains, does the promotion regime apply and which route
   permits the actual app/store communications?
5. What additional privacy, consumer and transfer/estate requirements apply to
   the chosen service scope?

No adviser has been contacted and no external request has been sent.
