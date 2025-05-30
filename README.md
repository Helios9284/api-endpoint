# Token Supply API

A simple API to retrieve total supply and circulating supply for ERC20 tokens.

## Endpoints

### Standard Endpoints

#### Total Supply
```
GET /api/total-supply
```
Returns the total supply of a token in human-readable format.

Query Parameters:
- `token` (optional): Token contract address. Defaults to 0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5 if not provided.

Example:
```
https://your-api-domain.com/api/total-supply?token=0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5
```

#### Circulating Supply
```
GET /api/circulating-supply
```
Returns the circulating supply of a token in human-readable format, calculated using the formula: Total Supply - (Locked Tokens + Treasury/Team Wallets + Burned Tokens).

Query Parameters:
- `token` (optional): Token contract address. Defaults to 0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5 if not provided.
- `percentage` (optional): Override the circulating supply to be a specific percentage of the total supply.

Example:
```
https://your-api-domain.com/api/circulating-supply?token=0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5
```

#### Token Info
```
GET /api/token-info
```
Returns detailed information about a token in JSON format, including name, symbol, decimals, and total supply.

Query Parameters:
- `token` (optional): Token contract address. Defaults to 0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5 if not provided.
- `calculate` (optional): Set to 'true' to include circulating supply information in the response.

Example:
```
https://your-api-domain.com/api/token-info?token=0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5
```

#### Circulating Supply Calculation
```
GET /api/circulating-calculation
```
Returns detailed information about the circulating supply calculation, including a breakdown of non-circulating tokens by category (locked, treasury/team, burned).

Query Parameters:
- `token` (optional): Token contract address. Defaults to 0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5 if not provided.

Example:
```
https://your-api-domain.com/api/circulating-calculation?token=0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5
```

### CoinMarketCap Compatible Endpoints

#### CMC Circulating Supply
```
GET /cmc/circulating
```
Returns the circulating supply as a raw value without decimal formatting, compatible with CoinMarketCap.

Query Parameters:
- `token` (optional): Token contract address. Defaults to 0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5 if not provided.
- `percentage` (optional): Override the circulating supply to be a specific percentage of the total supply.

Example:
```
https://your-api-domain.com/cmc/circulating
```

#### CMC Total Supply
```
GET /cmc/total
```
Returns the total supply in a format compatible with CoinMarketCap.

Query Parameters:
- `token` (optional): Token contract address. Defaults to 0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5 if not provided.

Example:
```
https://your-api-domain.com/cmc/total
```

## Setup

1. Install dependencies:
```
npm install
```

2. Configure environment (optional):
Create a `.env` file with the following variables:
```
PORT=3000
RPC_URL=https://eth.llamarpc.com
DEFAULT_TOKEN=0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5
TOKEN_DECIMALS=18
ETHERSCAN_API_KEY=your_etherscan_api_key  # Used for analyzing token holders
```

3. Start the server:
```
npm start
```

The server will run on port 3000 by default or on the port specified in the PORT environment variable.

## How It Works

This API uses a combination of direct blockchain queries and holder analysis to provide accurate token supply information:

### Token Details
- Fetches token name, symbol, decimals, and total supply directly from the blockchain
- Supports various standard ERC20 methods for total supply (totalSupply, getSupply, supply, cap)

### Circulating Supply Calculation
The API calculates circulating supply using the industry-standard formula:
```
Circulating Supply = Total Supply - (Locked Tokens + Treasury/Team Wallets + Burned Tokens)
```

It identifies these non-circulating tokens by:
1. **Burn Addresses**: Detects common burn addresses (0x0000..., 0x...dead, etc.)
2. **Treasury/Team Wallets**: Identifies wallets that predominantly send tokens out
3. **Lock/Vesting Contracts**: Identifies addresses that primarily receive tokens

This approach provides a much more accurate representation of actual circulating supply compared to using the total supply or contract-reported values. 