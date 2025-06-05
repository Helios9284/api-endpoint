require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;
const rpcUrl = process.env.RPC_URL || 'https://eth.llamarpc.com';
const defaultToken = process.env.DEFAULT_TOKEN || '0xf4A509313437dfC64E2EFeD14e2b607B1AED30c5';
const tokenDecimals = parseInt(process.env.TOKEN_DECIMALS || '18');
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || 'XSYFSIXZWAZNQITTX2R8EQIAZGHFIYJM9S';

app.use(express.json());
app.set('json spaces', 2);

const erc20Abi = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function getCirculatingSupply() view returns (uint256)",
  "function circulatingSupply() view returns (uint256)",
  "function getSupply() view returns (uint256)",
  "function supply() view returns (uint256)",
  "function cap() view returns (uint256)"
];

const provider = new ethers.providers.JsonRpcProvider({
  url: rpcUrl,
});

async function getTokenDetails(tokenAddress) {
  console.log(`Fetching details for token: ${tokenAddress}`);
  
  try {
    if (!ethers.utils.isAddress(tokenAddress)) {
      throw new Error(`Invalid token address format: ${tokenAddress}`);
    }
    
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    
    let name = "Unknown";
    let symbol = "Unknown";
    let decimals = tokenDecimals;
    
    try {
      name = await tokenContract.name();
      console.log(`Token name: ${name}`);
    } catch (error) {
      console.log(`Could not get token name: ${error.message}`);
    }
    
    try {
      symbol = await tokenContract.symbol();
      console.log(`Token symbol: ${symbol}`);
    } catch (error) {
      console.log(`Could not get token symbol: ${error.message}`);
    }
    
    try {
      const contractDecimals = await tokenContract.decimals();
      decimals = parseInt(contractDecimals.toString());
      console.log(`Token decimals from contract: ${decimals}`);
    } catch (error) {
      console.log(`Could not get decimals from contract, using default: ${decimals}`);
    }
    
    let totalSupply;
    let totalSupplyMethod = "unknown";
    
    try {
      totalSupply = await tokenContract.totalSupply();
      totalSupplyMethod = "totalSupply()";
      console.log(`Total supply from ${totalSupplyMethod}: ${totalSupply.toString()}`);
    } catch (error) {
      console.log(`Error getting totalSupply: ${error.message}`);
      
      try {
        totalSupply = await tokenContract.getSupply();
        totalSupplyMethod = "getSupply()";
        console.log(`Total supply from ${totalSupplyMethod}: ${totalSupply.toString()}`);
      } catch (altError) {
        try {
          totalSupply = await tokenContract.supply();
          totalSupplyMethod = "supply()";
          console.log(`Total supply from ${totalSupplyMethod}: ${totalSupply.toString()}`);
        } catch (alt2Error) {
          try {
            totalSupply = await tokenContract.cap();
            totalSupplyMethod = "cap()";
            console.log(`Total supply from ${totalSupplyMethod}: ${totalSupply.toString()}`);
          } catch (alt3Error) {
            console.error(`All attempts to get total supply failed`);
            throw new Error(`Could not determine total supply from contract`);
          }
        }
      }
    }
    
    if (!totalSupply || totalSupply.eq(0)) {
      console.warn(`Warning: Total supply is zero or undefined, this might be incorrect`);
    }
    
    const formattedTotalSupply = ethers.utils.formatUnits(totalSupply, decimals);
    console.log(`Formatted total supply: ${formattedTotalSupply} ${symbol}`);
    
    return { 
      name,
      symbol,
      decimals,
      totalSupply,
      contract: tokenContract
    };
  } catch (error) {
    console.error(`Error getting token details: ${error.message}`);
    throw new Error(`Failed to get token details: ${error.message}`);
  }
}

async function calculateActualCirculatingSupply(tokenAddress, totalSupply, decimals) {
  console.log(`Calculating actual circulating supply for token: ${tokenAddress}`);
  
  try {
    const apiUrl = `https://api.ethplorer.io/getTopTokenHolders/${tokenAddress}?apiKey=freekey&limit=100`;
    const holdersResponse = await axios.get(apiUrl);
    
    if (!holdersResponse.data || !holdersResponse.data.holders) {
      console.warn("Could not fetch holder data from Ethplorer, falling back to total supply");
      return { 
        circulatingSupply: totalSupply, 
        circulatingPercentage: "100.00", 
        nonCirculatingBreakdown: {}
      };
    }
    
    const holders = holdersResponse.data.holders;
    
    // Common burn addresses to check
    const burnAddresses = [
      "0x0000000000000000000000000000000000000000",
      "0x000000000000000000000000000000000000dead",
      "0xdead000000000000000042069420694206942069",
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    ];
    
    const holderData = [];
    const totalSupplyBN = BigInt(totalSupply.toString());
    
    // Analyze top holders (limit to top 20 for efficiency)
    for (let i = 0; i < Math.min(20, holders.length); i++) {
      const holder = holders[i];
      const holderAddress = holder.address;
      const quantity = BigInt(Math.floor(holder.share * Number(totalSupplyBN) / 100)).toString();
      const percentage = holder.share;
      
      // Check if this is a burn address
      const isBurnAddress = burnAddresses.includes(holderAddress.toLowerCase());
      
      if (isBurnAddress) {
        holderData.push({ address: holderAddress, type: "BURN", quantity, percentage });
        continue;
      }
      
      // Check transaction history for this holder
      try {
        const txListUrl = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${tokenAddress}&address=${holderAddress}&page=1&offset=5&sort=desc&apikey=${etherscanApiKey}`;
        const txResponse = await axios.get(txListUrl);
        
        if (txResponse.data.status === "1" && txResponse.data.result.length > 0) {
          const txs = txResponse.data.result;
          
          // Try to identify treasury/team wallets based on patterns
          if (txs.every(tx => tx.from === holderAddress)) {
            holderData.push({ address: holderAddress, type: "TREASURY/TEAM", quantity, percentage });
          } else if (txs.every(tx => tx.to === holderAddress)) {
            holderData.push({ address: holderAddress, type: "LOCK/VESTING", quantity, percentage });
          } else {
            holderData.push({ address: holderAddress, type: "UNKNOWN", quantity, percentage });
          }
        } else {
          holderData.push({ address: holderAddress, type: "NO_TRANSACTIONS", quantity, percentage });
        }
      } catch (error) {
        console.log(`Error analyzing holder ${holderAddress}: ${error.message}`);
        holderData.push({ address: holderAddress, type: "ERROR", quantity, percentage });
      }
    }
    
    // Calculate non-circulating supply components
    const nonCirculatingTypes = ["BURN", "TREASURY/TEAM", "LOCK/VESTING"];
    const nonCirculatingData = holderData.filter(h => nonCirculatingTypes.includes(h.type));
    
    const nonCirculatingBreakdown = {};
    let totalNonCirculating = BigInt(0);
    
    // Group by type
    nonCirculatingData.forEach(data => {
      const type = data.type;
      if (!nonCirculatingBreakdown[type]) {
        nonCirculatingBreakdown[type] = {
          addresses: [],
          totalQuantity: BigInt(0),
          totalPercentage: 0
        };
      }
      
      nonCirculatingBreakdown[type].addresses.push({
        address: data.address,
        quantity: data.quantity,
        percentage: data.percentage
      });
      
      nonCirculatingBreakdown[type].totalQuantity = nonCirculatingBreakdown[type].totalQuantity + BigInt(data.quantity);
      nonCirculatingBreakdown[type].totalPercentage += data.percentage;
      totalNonCirculating = totalNonCirculating + BigInt(data.quantity);
    });
    
    // Calculate circulating supply
    const circulatingSupply = totalSupplyBN - totalNonCirculating;
    const circulatingPercentage = (100 - (parseFloat(totalNonCirculating) * 100 / parseFloat(totalSupplyBN))).toFixed(2);
    
    console.log(`Calculated circulating supply: ${circulatingSupply.toString()} (${circulatingPercentage}% of total)`);
    
    // Format the breakdown for readability
    Object.keys(nonCirculatingBreakdown).forEach(type => {
      nonCirculatingBreakdown[type].totalQuantity = nonCirculatingBreakdown[type].totalQuantity.toString();
      nonCirculatingBreakdown[type].totalPercentage = nonCirculatingBreakdown[type].totalPercentage.toFixed(2);
    });
    
    return {
      circulatingSupply,
      circulatingPercentage,
      nonCirculatingBreakdown
    };
  } catch (error) {
    console.error(`Error calculating actual circulating supply: ${error.message}`);
    console.warn("Falling back to total supply as circulating supply");
    return { 
      circulatingSupply: totalSupply, 
      circulatingPercentage: "100.00",
      nonCirculatingBreakdown: {}
    };
  }
}

app.get('/api/total-supply', async (req, res) => {
  try {
    const tokenAddress = req.query.token || defaultToken;
    console.log(`Processing total supply request for token: ${tokenAddress}`);
    
    const tokenDetails = await getTokenDetails(tokenAddress);
    const response = {
      address: tokenAddress,
      name: tokenDetails.name,
      symbol: tokenDetails.symbol,
      decimals: tokenDetails.decimals,
      totalSupply: {
        raw: tokenDetails.totalSupply.toString(),
        formatted: ethers.utils.formatUnits(tokenDetails.totalSupply, tokenDetails.decimals)
      },
    }

    res.json(response);
  } catch (error) {
    console.error(`Error in total supply endpoint: ${error.message}`);
    res.status(500).send(`Error fetching total supply: ${error.message}`);
  }
});

app.get('/api/circulating-supply', async (req, res) => {
  try {
    const tokenAddress = req.query.token || defaultToken;
    const circulatingPercentage = req.query.percentage ? parseFloat(req.query.percentage) : null;
    
    console.log(`Processing circulating supply request for token: ${tokenAddress}`);
    
    const tokenDetails = await getTokenDetails(tokenAddress);
    
    let circulatingSupply;
    
    if (circulatingPercentage !== null && circulatingPercentage >= 0 && circulatingPercentage <= 100) {
      console.log(`Using manual override: ${circulatingPercentage}% of total supply`);
      circulatingSupply = tokenDetails.totalSupply.mul(Math.floor(circulatingPercentage * 100)).div(10000);
    } else {
      // By default, use the actual calculation
      console.log("Using formula-based calculation for circulating supply");
      const calculation = await calculateActualCirculatingSupply(
        tokenAddress, 
        tokenDetails.totalSupply, 
        tokenDetails.decimals
      );
      circulatingSupply = calculation.circulatingSupply;
    }
    const response = {
      address: tokenAddress,
      name: tokenDetails.name,
      symbol: tokenDetails.symbol,
      decimals: tokenDetails.decimals,
      circulatingSupply: {
        raw: circulatingSupply.toString(),
        formattedSupply : ethers.utils.formatUnits(circulatingSupply, tokenDetails.decimals)
      },
    }

    res.json(response);
  } catch (error) {
    console.error(`Error in circulating supply endpoint: ${error.message}`);
    res.status(500).send(`Error fetching circulating supply: ${error.message}`);
  }
});

app.get('/cmc/circulating', async (req, res) => {
  try {
    const tokenAddress = req.query.token || defaultToken;
    const circulatingPercentage = req.query.percentage ? parseFloat(req.query.percentage) : null;
    
    console.log(`Processing CMC circulating supply request for token: ${tokenAddress}`);
    
    const tokenDetails = await getTokenDetails(tokenAddress);
    
    let circulatingSupply;
    
    if (circulatingPercentage !== null && circulatingPercentage >= 0 && circulatingPercentage <= 100) {
      console.log(`Using manual override: ${circulatingPercentage}% of total supply`);
      circulatingSupply = tokenDetails.totalSupply.mul(Math.floor(circulatingPercentage * 100)).div(10000);
    } else {
      // By default, use the actual calculation
      console.log("Using formula-based calculation for circulating supply");
      const calculation = await calculateActualCirculatingSupply(
        tokenAddress, 
        tokenDetails.totalSupply, 
        tokenDetails.decimals
      );
      circulatingSupply = calculation.circulatingSupply;
    }
    
    // Ensure we return just the number
    const rawSupply = circulatingSupply.toString();
    
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write(rawSupply);
    res.end();
  } catch (error) {
    console.error(`Error in CMC circulating supply endpoint: ${error.message}`);
    res.status(500).send(`Error fetching circulating supply: ${error.message}`);
  }
});

app.get('/cmc/total', async (req, res) => {
  try {
    const tokenAddress = req.query.token || defaultToken;
    console.log(`Processing CMC total supply request for token: ${tokenAddress}`);
    
    const tokenDetails = await getTokenDetails(tokenAddress);
    
    const formattedSupply = ethers.utils.formatUnits(tokenDetails.totalSupply, tokenDetails.decimals);
    
    res.setHeader('Content-Type', 'text/plain');
    res.send(formattedSupply);
  } catch (error) {
    console.error(`Error in CMC total supply endpoint: ${error.message}`);
    res.status(500).send(`Error fetching total supply: ${error.message}`);
  }
});

app.get('/api/token-info', async (req, res) => {
  try {
    const tokenAddress = req.query.token || defaultToken;
    const manualCalculation = req.query.calculate === 'true';
    
    console.log(`Processing token info request for token: ${tokenAddress}`);
    
    const tokenDetails = await getTokenDetails(tokenAddress);
    const totalSupplyFormatted = ethers.utils.formatUnits(tokenDetails.totalSupply, tokenDetails.decimals);
    
    let circulatingData = {
      circulatingSupply: tokenDetails.totalSupply,
      circulatingPercentage: "100.00",
      nonCirculatingBreakdown: {}
    };
    
    if (manualCalculation) {
      console.log("Calculating actual circulating supply");
      circulatingData = await calculateActualCirculatingSupply(
        tokenAddress, 
        tokenDetails.totalSupply, 
        tokenDetails.decimals
      );
    }
    
    const circulatingSupplyFormatted = ethers.utils.formatUnits(circulatingData.circulatingSupply, tokenDetails.decimals);
    
    const response = {
      address: tokenAddress,
      name: tokenDetails.name,
      symbol: tokenDetails.symbol,
      decimals: tokenDetails.decimals,
      totalSupply: {
        raw: tokenDetails.totalSupply.toString(),
        formatted: totalSupplyFormatted
      }
    };
    
    if (manualCalculation) {
      response.circulatingSupply = {
        raw: circulatingData.circulatingSupply.toString(),
        formatted: circulatingSupplyFormatted,
        percentOfTotal: `${circulatingData.circulatingPercentage}%`
      };
      
      response.nonCirculatingSupply = {
        breakdown: circulatingData.nonCirculatingBreakdown
      };
    }
    
    res.json(response);
  } catch (error) {
    console.error(`Error in token info endpoint: ${error.message}`);
    res.status(500).json({
      error: true,
      message: `Error fetching token info: ${error.message}`
    });
  }
});

app.get('/api/circulating-calculation', async (req, res) => {
  try {
    const tokenAddress = req.query.token || defaultToken;
    
    console.log(`Processing circulating calculation request for token: ${tokenAddress}`);
    
    const tokenDetails = await getTokenDetails(tokenAddress);
    const calculation = await calculateActualCirculatingSupply(
      tokenAddress, 
      tokenDetails.totalSupply, 
      tokenDetails.decimals
    );
    
    const totalSupplyFormatted = ethers.utils.formatUnits(tokenDetails.totalSupply, tokenDetails.decimals);
    const circulatingSupplyFormatted = ethers.utils.formatUnits(calculation.circulatingSupply, tokenDetails.decimals);
    const nonCirculatingSupply = tokenDetails.totalSupply.sub(calculation.circulatingSupply);
    const nonCirculatingSupplyFormatted = ethers.utils.formatUnits(nonCirculatingSupply, tokenDetails.decimals);
    
    const response = {
      address: tokenAddress,
      name: tokenDetails.name,
      symbol: tokenDetails.symbol,
      decimals: tokenDetails.decimals,
      totalSupply: {
        raw: tokenDetails.totalSupply.toString(),
        formatted: totalSupplyFormatted
      },
      circulatingSupply: {
        raw: calculation.circulatingSupply.toString(),
        formatted: circulatingSupplyFormatted,
        percentOfTotal: `${calculation.circulatingPercentage}%`
      },
      nonCirculatingSupply: {
        raw: nonCirculatingSupply.toString(),
        formatted: nonCirculatingSupplyFormatted,
        percentOfTotal: `${(100 - parseFloat(calculation.circulatingPercentage)).toFixed(2)}%`,
        breakdown: calculation.nonCirculatingBreakdown
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error(`Error in circulating calculation endpoint: ${error.message}`);
    res.status(500).json({
      error: true,
      message: `Error calculating circulating supply: ${error.message}`
    });
  }
});

app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Server Error');
});

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
}); 
