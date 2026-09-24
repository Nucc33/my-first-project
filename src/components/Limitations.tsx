export default function Limitations() {
  return (
    <div className="panel">
      <h2>What this scanner does not handle</h2>
      <ul className="limits">
        <li>
          <strong>Resolution risk.</strong> Two venues can resolve &ldquo;the same&rdquo; question differently. Postponements, rule
          wording, and data sources cause most failed arbitrages. A pair is only as good as the human review behind it.
        </li>
        <li>
          <strong>Legging risk.</strong> The second order may not fill at the quoted price. Every opportunity shown here is
          indicative only. Books are snapshots, and the data-age column tells you how old they are.
        </li>
        <li>
          <strong>Costs not modeled.</strong> Deposits, withdrawals, bridging and FX are not included. Polymarket settles in
          pUSD/USDC and Kalshi in USD. The opportunity cost of capital locked until resolution isn&apos;t modeled either
          (annualized ROI is only a rough guide).
        </li>
        <li>
          <strong>Eligibility.</strong> Whether you can use each platform depends on your jurisdiction. Check each venue&apos;s terms
          of service: <a href="https://kalshi.com/terms" target="_blank" rel="noreferrer">Kalshi</a>,{" "}
          <a href="https://polymarket.com/tos" target="_blank" rel="noreferrer">Polymarket</a>.
        </li>
        <li>
          <strong>Fees are conservative approximations.</strong> Kalshi fees are rounded up to the whole cent per price level.
          Polymarket fees are rounded up at 5 decimals. Markets with a Polymarket fee exponent other than 1 are skipped.
        </li>
      </ul>
    </div>
  );
}
