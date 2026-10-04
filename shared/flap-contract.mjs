import { parseAbi } from 'viem';
// Flap's verified BNB mainnet V6 launch interface.
export const PORTAL="0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
export const TAX_V3_IMPL="0x024f18294970B5c76c0691b87f138A0317156422";
export const portalAbi=parseAbi(["error InvalidDexThresholdType(uint8 threshold)","error InvalidMigratorType()","struct NewTokenV6Params { string name; string symbol; string meta; uint8 dexThresh; bytes32 salt; uint8 migratorType; address quoteToken; uint256 quoteAmt; address beneficiary; bytes permitData; bytes32 extensionID; bytes extensionData; uint8 dexId; uint8 lpFeeProfile; uint16 buyTaxRate; uint16 sellTaxRate; uint64 taxDuration; uint64 antiFarmerDuration; uint16 mktBps; uint16 deflationBps; uint16 dividendBps; uint16 lpBps; uint256 minimumShareBalance; address dividendToken; address commissionReceiver; uint8 tokenVersion; }","function newTokenV6(NewTokenV6Params params) payable returns (address token)"]);
