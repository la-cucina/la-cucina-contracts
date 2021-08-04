require('chai').should();
const { expect } = require('chai');
const { expectRevert, ether, BN, time, expectEvent } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS, MAX_UINT256 } = require('@openzeppelin/test-helpers/src/constants');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');

const ERC1155NFT = artifacts.require('ERC1155NFT');
const PrivateMarketplace = artifacts.require('PrivateMarketplace');
const PublicMarketplace = artifacts.require('PublicMarketplace');

const SampleToken = artifacts.require('SampleToken');

const url = 'https://token-cdn-domain/{id}.json';

contract('PublicMarketplace', accounts => {
  const owner = accounts[0];
  const minter = accounts[1];
  const user1 = accounts[2];
  const user2 = accounts[3];
  const user3 = accounts[4];

  before('Deploy ERC-1155 and Marketplace contracts', async () => {
    // deploy NFT token
    this.ERC1155NFT = await deployProxy(ERC1155NFT, [url], { initializer: 'initialize' });

    // deploy private marketplace
    this.privateMarketplace = await deployProxy(PrivateMarketplace, [this.ERC1155NFT.address], {
      initializer: 'initialize',
    });

    // deploy Public marketplace
    this.publicMarketplace = await deployProxy(PublicMarketplace, [this.ERC1155NFT.address], {
      initializer: 'initialize',
    });

    // add privateMarket as minter in ERC1155 contract.
    const minterRole = await this.ERC1155NFT.MINTER_ROLE();
    await this.ERC1155NFT.grantRole(minterRole, this.privateMarketplace.address);

    // add excepted address
    await this.ERC1155NFT.addExceptedAddress(this.privateMarketplace.address);
    // add excepted address
    await this.ERC1155NFT.addExceptedAddress(this.publicMarketplace.address);

    // add minter in privateMarketplace
    await this.privateMarketplace.grantRole(minterRole, minter);

    // add minter in publicMarketplace
    await this.publicMarketplace.grantRole(minterRole, minter);

    // deploy Lac token
    this.sampleToken = await SampleToken.new();

    // add supported token
    await this.privateMarketplace.addSupportedToken(this.sampleToken.address);
    await this.publicMarketplace.addSupportedToken(this.sampleToken.address);

    // mint tokens to users
    await this.sampleToken.mint(user1, ether('100'));
    await this.sampleToken.mint(user2, ether('100'));
    await this.sampleToken.mint(user3, ether('100'));
  });

  describe('initialize()', () => {
    it('should initialize the min duration correctly', async () => {
      const minDuration = await this.publicMarketplace.minDuration();
      expect(minDuration).to.bignumber.be.eq(new BN('86400'));
    });

    it('should initialize the NFT contract address correctly', async () => {
      const nftContractAddress = await this.publicMarketplace.nftContract();
      expect(this.ERC1155NFT.address).to.be.eq(nftContractAddress);
    });
  });

  describe('sellNFT()', () => {
    let currentPrivateSaleId;
    let currentSaleId;
    let currentNftId;
    before('create and sell NFT to user1', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale to close sale
      await this.sampleToken.approve(this.privateMarketplace.address, MAX_UINT256, { from: user1 });

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      this.user1NftBal = await this.ERC1155NFT.balanceOf(user1, currentNftId);

      // approve nft to PublicMarketplace contract
      await this.ERC1155NFT.setApprovalForAll(this.publicMarketplace.address, true, { from: user1 });

      // create sale for the nft
      this.sale1 = await this.publicMarketplace.sellNFT(currentNftId, ether('2'), this.sampleToken.address, {
        from: user1,
      });
    });

    it('should generate sale id correctly', async () => {
      currentSaleId = await this.publicMarketplace.getCurrentSaleId();

      const userSaleIds = await this.publicMarketplace.userSaleIds(user1, 0);

      expect(userSaleIds).to.bignumber.be.eq(new BN('1'));
      expect(currentSaleId).to.bignumber.be.eq(new BN('1'));
    });

    it('should store sale details correctly', async () => {
      // get sale details
      const sale = await this.publicMarketplace.sale(currentSaleId);

      expect(sale.seller).to.be.eq(user1);
      expect(sale.buyer).to.be.eq(ZERO_ADDRESS);
      expect(sale.currency).to.be.eq(this.sampleToken.address);
      expect(sale.nftId).to.bignumber.be.eq(new BN('1'));
      expect(sale.totalCopies).to.bignumber.be.eq(new BN('1'));
      expect(sale.remainingCopies).to.bignumber.be.eq(new BN('1'));
      expect(sale.sellingPrice).to.bignumber.be.eq(new BN(ether('2')));
      expect(sale.sellTimeStamp).to.bignumber.be.eq(new BN('0'));
      expect(sale.cancelTimeStamp).to.bignumber.be.eq(new BN('0'));
    });

    it('should revert when seller tries to create NFT sale with unsupported tokens', async () => {
      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      await expectRevert(
        this.publicMarketplace.sellNFT(currentNftId, ether('2'), ZERO_ADDRESS, { from: user1 }),
        'Market: UNSUPPORTED_TOKEN',
      );
    });

    it('should revert when seller tries to create NFT sale with 0 initial price', async () => {
      await expectRevert(
        this.publicMarketplace.sellNFT(currentNftId, ether('0'), this.sampleToken.address, { from: user1 }),
        'PublicMarket: INVALID_NFT_PRICE',
      );
    });

    it('should emit event after successfully creating nft sale', async () => {
      await expectEvent(this.sale1, 'NewNFTListing', [user1, '1']);
    });
  });

  describe('createNFTAuction()', () => {
    let currentPrivateSaleId;
    let currentAuctionId;
    let currentNftId;
    before('create and auction NFT', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // approve nft to PublicMarketplace contract
      await this.ERC1155NFT.setApprovalForAll(this.publicMarketplace.address, true, { from: user1 });

      // create auction
      this.auction1 = await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );
    });

    it('should generate auction id correctly', async () => {
      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();

      const userAuctionIds = await this.publicMarketplace.userAuctionIds(user1, 0);

      expect(currentAuctionId).to.bignumber.be.eq(new BN('1'));
      expect(userAuctionIds).to.bignumber.be.eq(new BN('1'));
    });

    it('should store auction details correctly', async () => {
      // get auction details
      const auction = await this.publicMarketplace.auction(currentAuctionId);

      expect(auction.nftId).to.bignumber.be.eq(currentNftId);
      expect(auction.sellerAddress).to.be.eq(user1);
      expect(auction.initialPrice).to.bignumber.be.eq(ether('1'));
      expect(auction.currency).to.be.eq(this.sampleToken.address);
      expect(auction.duration).to.bignumber.be.eq(new BN(String(time.duration.days('2'))));
      expect(auction.status).to.bignumber.be.eq(new BN('1'));
      expect(auction.winningBidId).to.bignumber.be.eq(new BN('0'));
      expect(auction.cancelTimeStamp).to.bignumber.be.eq(new BN('0'));
      expect(auction.buyTimestamp).to.bignumber.be.eq(new BN('0'));
    });
    it('should revert when seller tries to create auction with invalid duration', async () => {
      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      await expectRevert(
        this.publicMarketplace.createNFTAuction(currentNftId, ether('1'), this.sampleToken.address, '100', {
          from: user1,
        }),
        'Market: INVALID_DURATION',
      );
    });

    it('should revert when seller tries to create NFT and auction with unsupported tokens', async () => {
      await expectRevert(
        this.publicMarketplace.createNFTAuction(
          currentNftId,
          ether('1'),
          ZERO_ADDRESS,
          String(time.duration.days('2')),
          {
            from: user1,
          },
        ),
        'Market: UNSUPPORTED_TOKEN',
      );
    });

    it('should revert when minter tries to create NFT and auction with 0 initial price', async () => {
      await expectRevert(
        this.publicMarketplace.createNFTAuction(
          currentNftId,
          ether('0'),
          this.sampleToken.address,
          String(time.duration.days('2')),
          {
            from: user1,
          },
        ),
        'PublicMarket: INVALID_INITIAL_NFT_PRICE',
      );
    });

    it('should emit event after successfully creating nft auction', async () => {
      await expectEvent(this.auction1, 'NFTAuction', [user1, '1']);
    });
  });

  describe('updateSale()', () => {
    let saleBeforeUpdate;
    let currentNftId;
    let currentSaleId;
    before('update current sale', async () => {
      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentSaleId = await this.publicMarketplace.getCurrentSaleId();

      saleBeforeUpdate = await this.publicMarketplace.sale(currentSaleId);

      // update sale
      await this.publicMarketplace.updateSale(currentSaleId, ether('3'), { from: user1 });
    });

    it('should update sale price correctly', async () => {
      const saleAfterUpdate = await this.publicMarketplace.sale(currentSaleId);

      expect(saleAfterUpdate.sellingPrice).to.bignumber.be.gt(saleBeforeUpdate.sellingPrice);
      expect(saleAfterUpdate.sellingPrice).to.bignumber.be.eq(ether('3'));
    });

    it('should revert when non-seller tries to update the sale', async () => {
      await expectRevert(
        this.publicMarketplace.updateSale(currentSaleId, ether('2'), { from: user2 }),
        'Market:ONLY_SELLER_CAN_UPDATE',
      );
    });

    it('should revert when seller tries to update the sale with zero price', async () => {
      await expectRevert(
        this.publicMarketplace.updateSale(currentSaleId, ether('0'), { from: user1 }),
        'Market: INVALID_SELLING_PRICE',
      );
    });

    it('should revert when seller tries to update the sale with same price', async () => {
      await expectRevert(
        this.publicMarketplace.updateSale(currentSaleId, ether('3'), { from: user1 }),
        'Market: INVALID_SELLING_PRICE',
      );
    });

    it('should revert when seller tries to update the sale with invalid sale id', async () => {
      await expectRevert(this.publicMarketplace.updateSale(15, ether('5'), { from: user1 }), 'Market: INVALID_SALE_ID');
    });

    it('should revert when seller tries to update the sale which is ended already', async () => {
      // buy nft from sale to close sale
      await this.sampleToken.approve(this.publicMarketplace.address, MAX_UINT256, { from: user2 });
      await this.publicMarketplace.buyNFT(currentSaleId, { from: user2 });

      await expectRevert(
        this.publicMarketplace.updateSale(currentSaleId, ether('4'), { from: user1 }),
        'Market: SALE_ALREADY_ENDED',
      );
    });
  });

  describe('updateAuction()', () => {
    let currentAuctionId;
    let auctionBeforeUpdate;

    before('update current auction', async () => {
      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();
      auctionBeforeUpdate = await this.publicMarketplace.auction(currentAuctionId);

      // update auction
      await this.publicMarketplace.updateAuction(currentAuctionId, ether('2'), String(time.duration.days('1')), {
        from: user1,
      });
    });

    it('should update the initial price and duration correctly', async () => {
      const auctionAfterUpdate = await this.publicMarketplace.auction(currentAuctionId);

      expect(auctionBeforeUpdate.initialPrice).to.bignumber.be.eq(ether('1'));
      expect(auctionBeforeUpdate.duration).to.bignumber.be.eq(String(time.duration.days('2')));
      expect(auctionAfterUpdate.initialPrice).to.bignumber.be.eq(ether('2'));
      expect(auctionAfterUpdate.duration).to.bignumber.be.eq(String(time.duration.days('3')));
    });

    it('should revert when non-seller tries to update the auction', async () => {
      await expectRevert(
        this.publicMarketplace.updateAuction(currentAuctionId, ether('3'), String(time.duration.days('3')), {
          from: user3,
        }),
        'Market:ONLY_SELLER_CAN_UPDATE',
      );
    });

    it('should revert when seller tries to update the auction with zero initial price', async () => {
      await expectRevert(
        this.publicMarketplace.updateAuction(currentAuctionId, ether('0'), String(time.duration.days('1')), {
          from: user1,
        }),
        'Market: INVALID_INITIAL_PRICE',
      );
    });

    it('should revert when seller tries to update the auction with same initial price', async () => {
      await expectRevert(
        this.publicMarketplace.updateAuction(currentAuctionId, ether('2'), String(time.duration.days('1')), {
          from: user1,
        }),
        'Market: INVALID_INITIAL_PRICE',
      );
    });

    it('should revert when seller tries to update the auction with invalid auction id', async () => {
      await expectRevert(
        this.publicMarketplace.updateAuction(9, ether('5'), String(time.duration.days('1')), {
          from: user1,
        }),
        'Market: INVALID_AUCTION_ID',
      );
    });

    it('should revert when seller tries to update the auction with non-zero bids', async () => {
      // approve tokens
      await this.sampleToken.approve(this.publicMarketplace.address, MAX_UINT256, { from: user2 });

      // place bid
      await this.publicMarketplace.placeBid(currentAuctionId, ether('2'), { from: user2 });

      await expectRevert(
        this.publicMarketplace.updateAuction(currentAuctionId, ether('3'), String(time.duration.days('1')), {
          from: user1,
        }),
        'Market: CANNOT_UPDATE_AUCTION_WITH_NON_ZERO_BIDS',
      );
    });
    it('should revert when seller tries to update the inactive auction', async () => {
      // advance time
      await time.increase(String(time.duration.days('3')));

      // resolve auction
      await this.publicMarketplace.resolveAuction(currentAuctionId);

      await expectRevert(
        this.publicMarketplace.updateAuction(currentAuctionId, ether('3'), String(time.duration.days('1')), {
          from: user1,
        }),
        'Market: CANNOT_UPDATE_INACTIVE_AUCTION',
      );
    });
  });

  describe('cancelSaleAndClaimNFT()', () => {
    let currentNftId;
    let currentPrivateSaleId;
    let currentSaleId;
    let saleBeforeCancel;
    let user1NFTBalBefore;
    before('cancelSaleAndClaimNFT', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create sale for the nft
      await this.publicMarketplace.sellNFT(currentNftId, ether('2'), this.sampleToken.address, {
        from: user1,
      });

      currentSaleId = await this.publicMarketplace.getCurrentSaleId();
      saleBeforeCancel = await this.publicMarketplace.sale(currentSaleId);
      user1NFTBalBefore = await this.ERC1155NFT.balanceOf(user1, currentNftId);

      // cancel sale
      await this.publicMarketplace.cancelSaleAndClaimToken(currentSaleId, { from: user1 });
    });

    it('should update sale status to canceled correctly', async () => {
      const user1NFTBalAfter = await this.ERC1155NFT.balanceOf(user1, currentNftId);

      const saleAfter = await this.publicMarketplace.sale(currentSaleId);

      const isActiveSale = await this.publicMarketplace.isActiveSale(currentSaleId);

      expect(user1NFTBalBefore).to.bignumber.be.eq(new BN('0'));
      expect(user1NFTBalAfter).to.bignumber.be.eq(new BN('1'));
      expect(saleBeforeCancel.cancelTimeStamp).to.bignumber.be.eq(new BN('0'));
      expect(saleAfter.cancelTimeStamp).to.bignumber.be.gt(new BN('0'));
      expect(isActiveSale).to.be.eq(false);
    });

    it('should revert if non-seller tries to cancel the sale', async () => {
      await expectRevert(
        this.publicMarketplace.cancelSaleAndClaimToken(currentSaleId, { from: user3 }),
        'PublicMarket: ONLY_SELLER_CAN_CANCEL',
      );
    });

    it('should revert if non-seller tries to cancel the inactive sale', async () => {
      await expectRevert(
        this.publicMarketplace.cancelSaleAndClaimToken(currentSaleId, { from: user1 }),
        'PublicMarket: CANNOT_CANCEL_INACTIVE_SALE',
      );
    });
  });

  describe('cancelAuctionAndClaimNFT()', () => {
    let currentPrivateSaleId;
    let currentNftId;
    let currentAuctionId;
    let AuctionBeforeCancel;
    let user1NFTBalBefore;
    before('cancel auction and claim nft', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();
      AuctionBeforeCancel = await this.publicMarketplace.auction(currentAuctionId);
      user1NFTBalBefore = await this.ERC1155NFT.balanceOf(user1, currentNftId);
    });

    it('should transfer nft back to user after cancelling auction', async () => {
      // cancel sale
      await this.publicMarketplace.cancelAuctionAndClaimToken(currentAuctionId, { from: user1 });

      const AuctionAfterCancel = await this.publicMarketplace.auction(currentAuctionId);
      const user1NFTBalAfter = await this.ERC1155NFT.balanceOf(user1, currentNftId);

      expect(AuctionBeforeCancel.status).to.bignumber.be.eq(new BN('1'));
      expect(AuctionAfterCancel.status).to.bignumber.be.eq(new BN('2'));
      expect(user1NFTBalBefore).to.bignumber.be.eq(new BN('0'));
      expect(user1NFTBalAfter).to.bignumber.be.eq(new BN('1'));
    });

    it('should revert when non-seller tries to cancel the canceled auction', async () => {
      // cancel auction again
      await expectRevert(
        this.publicMarketplace.cancelAuctionAndClaimToken(currentAuctionId, { from: user1 }),
        'PublicMarket: CANNOT_CANCEL_INACTIVE_AUCTION',
      );
    });

    it('should not cancel auction with non-zero bids', async () => {
      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();

      // place bid
      await this.publicMarketplace.placeBid(currentAuctionId, ether('3'), { from: user2 });

      await expectRevert(
        this.publicMarketplace.cancelAuctionAndClaimToken(currentAuctionId, { from: user1 }),
        'PublicMarket: CANNOT_CANCEL_AUCTION_WITH_NON_ZERO_BIDS',
      );
    });

    it('should revert when non-seller tries to cancel the auction', async () => {
      await expectRevert(
        this.publicMarketplace.cancelAuctionAndClaimToken(currentAuctionId, { from: user3 }),
        'PublicMarket: ONLY_NFT_SELLER_CAN_CANCEL',
      );
    });

    it('should revert when seller tries to cancel auction with invalid auction id', async () => {
      await expectRevert(
        this.publicMarketplace.cancelAuctionAndClaimToken(16, { from: user1 }),
        'Market: INVALID_AUCTION_ID',
      );
    });
  });

  describe('buyNFT()', () => {
    let currentPrivateSaleId;
    let currentNftId;
    let currentSaleId;
    let publicMarketNFTBalBefore;
    let publicMarketNFTBalAfter;
    let user2NFTBalBefore;
    before('buy nft from sale', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create sale for the nft
      await this.publicMarketplace.sellNFT(currentNftId, ether('2'), this.sampleToken.address, {
        from: user1,
      });

      currentSaleId = await this.publicMarketplace.getCurrentSaleId();
      user2NFTBalBefore = await this.ERC1155NFT.balanceOf(user2, currentNftId);
      publicMarketNFTBalBefore = await this.ERC1155NFT.balanceOf(this.publicMarketplace.address, currentNftId);

      // buy nft from sale
      await this.publicMarketplace.buyNFT(currentSaleId, { from: user2 });
    });

    it('should reflect nft in user wallet and close the sale correctly', async () => {
      publicMarketNFTBalAfter = await this.ERC1155NFT.balanceOf(this.publicMarketplace.address, currentNftId);

      const user2NFTBalAfter = await this.ERC1155NFT.balanceOf(user2, currentNftId);

      expect(user2NFTBalBefore).to.bignumber.be.eq(new BN('0'));
      expect(user2NFTBalAfter).to.bignumber.be.eq(new BN('1'));
      expect(publicMarketNFTBalBefore).to.bignumber.be.eq(new BN('1'));
      expect(publicMarketNFTBalAfter).to.bignumber.be.eq(new BN('0'));
    });

    it('should revert when user tries to buy from invalid sale', async () => {
      await expectRevert(this.publicMarketplace.buyNFT(15, { from: user2 }), 'Market: INVALID_SALE_ID');
    });

    it('should revert when user tries to buy from inactive sale', async () => {
      await expectRevert(
        this.publicMarketplace.buyNFT(currentSaleId, { from: user2 }),
        'Market: CANNOT_BUY_FROM_INACTIVE_SALE',
      );
    });
  });

  describe('moveNftInSale()', () => {
    let currentPrivateSaleId;
    let currentNftId;
    let currentSaleId;
    let currentAuctionId;

    before('moveNftInSale', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();
    });

    it('should store sale details and cancel the exisiting auction correctly', async () => {
      // move nft from auction to sale
      this.tx = await this.publicMarketplace.moveNftInSale(currentAuctionId, ether('2'), { from: user1 });

      currentSaleId = await this.publicMarketplace.getCurrentSaleId();

      const auction = await this.publicMarketplace.auction(currentAuctionId);
      expect(auction.status).to.bignumber.be.eq(new BN('2'));

      const sale = await this.publicMarketplace.sale(currentSaleId);

      expect(sale.seller).to.be.eq(user1);
      expect(sale.buyer).to.be.eq(ZERO_ADDRESS);
      expect(sale.currency).to.be.eq(this.sampleToken.address);
      expect(sale.nftId).to.bignumber.be.eq(currentNftId);
      expect(sale.totalCopies).to.bignumber.be.eq(new BN('1'));
      expect(sale.remainingCopies).to.bignumber.be.eq(new BN('1'));
      expect(sale.sellingPrice).to.bignumber.be.eq(new BN(ether('2')));
      expect(sale.sellTimeStamp).to.bignumber.be.eq(new BN('0'));
      expect(sale.cancelTimeStamp).to.bignumber.be.eq(new BN('0'));
    });

    it('should revert when seller tries to move nft from inactive auction to sale', async () => {
      await expectRevert(
        this.publicMarketplace.moveNftInSale(currentAuctionId, ether('2'), { from: user1 }),
        'Market: CANNOT_MOVE_NFT_FROM_INACTIVE_AUCTION',
      );
    });

    it('should revert when seller tries to move nft from auction to sale with non zero bids', async () => {
      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();

      // place bid
      await this.publicMarketplace.placeBid(currentAuctionId, ether('4'), { from: user2 });

      await expectRevert(
        this.publicMarketplace.moveNftInSale(currentAuctionId, ether('2'), { from: user1 }),
        'Market: CANNOT_UPDATE_AUCTION',
      );
    });

    it('should revert when non-seller tries to move nft from auction to sale', async () => {
      await expectRevert(
        this.publicMarketplace.moveNftInSale(currentAuctionId, ether('2'), { from: user3 }),
        'Market: CALLER_NOT_THE_AUCTION_CREATOR',
      );
    });
  });

  describe('addSupportedToken()', () => {
    let isSupportedBefore;
    before('add supported token', async () => {
      isSupportedBefore = await this.publicMarketplace.isSupportedToken(ZERO_ADDRESS);

      // add supported token
      await this.publicMarketplace.addSupportedToken(ZERO_ADDRESS, { from: owner });
    });

    it('should add supported token correctly', async () => {
      const isSupportedAfter = await this.publicMarketplace.isSupportedToken(ZERO_ADDRESS);

      expect(isSupportedBefore[0]).to.be.eq(false);
      expect(isSupportedAfter[0]).to.be.eq(true);
    });

    it('should revert when admin tries to add token which is already supported', async () => {
      await expectRevert(
        this.publicMarketplace.addSupportedToken(ZERO_ADDRESS, { from: owner }),
        'Market: TOKEN_ALREADY_ADDED',
      );
    });

    it('should revert when non-admin tries to add the supported token', async () => {
      await expectRevert(
        this.publicMarketplace.addSupportedToken(ZERO_ADDRESS, { from: user2 }),
        'Market: ONLY_ADMIN_CAN_CALL',
      );
    });
  });

  describe('removeSupportedToken()', () => {
    let isSupportedBefore;
    before('remove supported token', async () => {
      isSupportedBefore = await this.publicMarketplace.isSupportedToken(ZERO_ADDRESS);

      // remove supported token
      await this.publicMarketplace.removeSupportedToken(ZERO_ADDRESS, { from: owner });
    });

    it('should remove supported token correctly', async () => {
      const isSupportedAfter = await this.publicMarketplace.isSupportedToken(ZERO_ADDRESS);

      expect(isSupportedBefore[0]).to.be.eq(true);
      expect(isSupportedAfter[0]).to.be.eq(false);
    });

    it('should revert when admin tries to remove token which does not supports already', async () => {
      await expectRevert(
        this.publicMarketplace.removeSupportedToken(ZERO_ADDRESS, { from: owner }),
        'Market: TOKEN_DOES_NOT_EXISTS',
      );
    });

    it('should revert when non-admin tries to remove the supported token', async () => {
      await expectRevert(
        this.publicMarketplace.removeSupportedToken(ZERO_ADDRESS, { from: minter }),
        'Market: ONLY_ADMIN_CAN_CALL',
      );
    });
  });

  describe('updateNftContract()', async () => {
    let nftContractAddressBefore;
    before('update nft contract', async () => {
      nftContractAddressBefore = await this.publicMarketplace.nftContract();
      // update nft contract
      await this.publicMarketplace.updateNftContract(this.sampleToken.address, { from: owner });
    });
    after('update nft contract to ERC1155 contract', async () => {
      // update nft contract to sampleToken
      await this.publicMarketplace.updateNftContract(this.ERC1155NFT.address, { from: owner });
    });

    it('should update nft contract correctly', async () => {
      const nftContractAddress = await this.publicMarketplace.nftContract();
      expect(nftContractAddress).to.be.eq(this.sampleToken.address);
    });

    it('should revert when admin update nft contract address with same contract address', async () => {
      await expectRevert(
        this.publicMarketplace.updateNftContract(this.sampleToken.address, { from: owner }),
        'Market: INVALID_CONTRACT_ADDRESS',
      );
    });

    it('should revert when admin update nft contract address with zero address', async () => {
      await expectRevert(
        this.publicMarketplace.updateNftContract(ZERO_ADDRESS, { from: owner }),
        'Market: INVALID_CONTRACT_ADDRESS',
      );
    });
    it('should revert when non-admin tries to update nft contract address', async () => {
      await expectRevert(
        this.publicMarketplace.updateNftContract(this.ERC1155NFT.address, { from: user2 }),
        'Market: ONLY_ADMIN_CAN_CALL',
      );
    });
  });

  describe('updateMinimumDuration()', async () => {
    let minimumDurationBefore;

    before('update minimum duration', async () => {
      minimumDurationBefore = await this.publicMarketplace.minDuration();

      // update minimum duration
      await this.publicMarketplace.updateMinimumDuration(String(time.duration.days('4')), { from: owner });
    });
    after('reset minimum duration to 1 days', async () => {
      // update minimum duration
      await this.publicMarketplace.updateMinimumDuration(String(time.duration.days('1')), { from: owner });
    });

    it('update minimum duration correctly', async () => {
      const minDurationAfter = await this.publicMarketplace.minDuration();
      expect(minDurationAfter).to.bignumber.be.eq(new BN('345600'));
    });

    it('should revert when admin tries to update minimum duration with same duration', async () => {
      await expectRevert(
        this.publicMarketplace.updateMinimumDuration(String(time.duration.days('4')), { from: owner }),
        'MintingStatoin: INVALID_MINIMUM_DURATION',
      );
    });

    it('should revert when admin tries to update minimum duration to zero', async () => {
      await expectRevert(
        this.publicMarketplace.updateMinimumDuration(String(time.duration.days('0')), { from: owner }),
        'MintingStatoin: INVALID_MINIMUM_DURATION',
      );
    });
    it('should revert when non-admin tries to update minimum duration', async () => {
      await expectRevert(
        this.publicMarketplace.updateMinimumDuration(String(time.duration.days('3')), { from: user2 }),
        'Market: ONLY_ADMIN_CAN_CALL',
      );
    });
  });

  describe('placeBid()', async () => {
    let currentAuctionId;
    let currentNftId;
    let user2BalanceBefore;
    let user2BalanceAfter;
    let currentBidId;
    let currentPrivateSaleId;

    before('create auction', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();
      user2BalanceBefore = await this.sampleToken.balanceOf(user2);

      // place bid for user1
      await this.publicMarketplace.placeBid(currentAuctionId, ether('2'), { from: user2 });

      currentBidId = await this.publicMarketplace.getCurrentBidId();
    });

    it('should set store bid details correctly', async () => {
      user2BalanceAfter = await this.sampleToken.balanceOf(user2);

      expect(user2BalanceBefore).to.bignumber.be.gt(user2BalanceAfter);

      const auction = await this.publicMarketplace.auction(currentAuctionId);
      expect(auction.winningBidId).to.bignumber.be.eq(currentBidId);

      const bid = await this.publicMarketplace.bid(currentBidId);

      expect(bid.auctionId).to.bignumber.be.eq(currentAuctionId);
      expect(bid.bidAmount).to.bignumber.be.eq(ether('2'));
      expect(bid.bidderAddress).to.be.eq(user2);
    });

    it('should return the tokens to previous bidder when someone places new bid', async () => {
      await this.sampleToken.approve(this.publicMarketplace.address, MAX_UINT256, { from: user3 });

      const user3BalBefore = await this.sampleToken.balanceOf(user3);

      // place bid for user3
      await this.publicMarketplace.placeBid(currentAuctionId, ether('3'), { from: user3 });

      currentBidId = await this.publicMarketplace.getCurrentBidId();

      const user3BalAfter = await this.sampleToken.balanceOf(user3);
      user2BalanceAfter = await this.sampleToken.balanceOf(user2);

      expect(user3BalBefore).to.bignumber.be.gt(user3BalAfter);
      expect(user2BalanceAfter).to.bignumber.be.eq(user2BalanceBefore);

      const auction = await this.publicMarketplace.auction(currentAuctionId);
      expect(auction.winningBidId).to.bignumber.be.eq(currentBidId);
    });

    it('should revert if tokens are not approved before placing bid', async () => {
      await this.sampleToken.mint(accounts[6], ether('7'), { from: owner });

      await expectRevert(
        this.publicMarketplace.placeBid(currentAuctionId, ether('7'), { from: accounts[6] }),
        'ERC20: transfer amount exceeds allowance',
      );
    });

    it('should revert when auction creator tries to place bid', async () => {
      await expectRevert(
        this.publicMarketplace.placeBid(currentAuctionId, ether('5'), { from: user1 }),
        'Market: OWNER_CANNOT_PLACE_BID',
      );
    });

    it('should revert when bidder tries to place bid with same bidamount', async () => {
      await expectRevert(
        this.publicMarketplace.placeBid(currentAuctionId, ether('3'), { from: user2 }),
        'Market: INVALID_BID_AMOUNT',
      );
    });

    it('should revert when bidder tries to place bid with less than initial auction price', async () => {
      await expectRevert(
        this.publicMarketplace.placeBid(currentAuctionId, '500000000000000000', { from: user2 }),
        'Market: INVALID_BID_AMOUNT',
      );
    });

    it('should revert when bidder tries to bid after auction period', async () => {
      // advance time
      await time.increase(String(time.duration.days('3')));

      await expectRevert(
        this.publicMarketplace.placeBid(currentAuctionId, ether('5'), { from: user2 }),
        'Market: CANNOT_BID_AFTER_AUCTION_ENDS.',
      );
    });

    it('should revert when bidder tries to bid on inactive auction', async () => {
      // resolve auction
      await this.publicMarketplace.resolveAuction(currentAuctionId);

      await expectRevert(
        this.publicMarketplace.placeBid(currentAuctionId, ether('6'), { from: user3 }),
        'Market: CANNOT_BID_ON_INACTIVE_AUCTION',
      );
    });

    it('should revert when bidder tries to bid with invalid auction id', async () => {
      await expectRevert(
        this.publicMarketplace.placeBid(15, ether('6'), { from: user2 }),
        'Market: INVALID_AUCTION_ID',
      );
    });
  });

  describe('resolveAuction()', () => {
    let currentPrivateSaleId;
    let currentAuctionId;
    let currentNftId;
    let contractBalanceBefore;
    let currentBidId;
    let user2NFTBalanceBefore;
    let contractNFTBalanceBefore;
    before('resolve auction', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();

      // place bid for user2
      await this.publicMarketplace.placeBid(currentAuctionId, ether('2'), { from: user2 });

      currentBidId = await this.publicMarketplace.getCurrentBidId();

      user2NFTBalanceBefore = await this.ERC1155NFT.balanceOf(user2, currentNftId);
      contractNFTBalanceBefore = await this.ERC1155NFT.balanceOf(this.publicMarketplace.address, currentNftId);
      contractBalanceBefore = await this.sampleToken.balanceOf(this.publicMarketplace.address);
    });

    it('should revert when anyone tries to resolve auction before auction end time', async () => {
      await expectRevert(
        this.publicMarketplace.resolveAuction(currentAuctionId),
        'Market: CANNOT_RESOLVE_DURING_AUCTION',
      );
    });

    it('should resolve the auction and update the auction status to close', async () => {
      // advance time to finish auction phase
      await time.increase(String(time.duration.days('3')));

      // resolve auction
      await this.publicMarketplace.resolveAuction(currentAuctionId);

      const auction = await this.publicMarketplace.auction(currentAuctionId);

      const user2NFTBalanceAfter = await this.ERC1155NFT.balanceOf(user2, currentNftId);
      const contractNFTBalanceAfter = await this.ERC1155NFT.balanceOf(this.publicMarketplace.address, currentNftId);
      const contractBalanceAfter = await this.sampleToken.balanceOf(this.publicMarketplace.address);

      expect(auction.status).to.bignumber.be.eq(new BN('0'));
      expect(user2NFTBalanceBefore).to.bignumber.be.eq(new BN('0'));
      expect(contractNFTBalanceBefore).to.bignumber.be.eq(new BN('1'));
      expect(user2NFTBalanceAfter).to.bignumber.be.eq(new BN('1'));
      expect(contractNFTBalanceAfter).to.bignumber.be.eq(new BN('0'));
      expect(contractBalanceBefore).to.bignumber.be.gt(contractBalanceAfter);
    });

    it('should revert when anyone tries to resolve auction which already resolved', async () => {
      await expectRevert(
        this.publicMarketplace.resolveAuction(currentAuctionId),
        'Market: CANNOT_RESOLVE_INACTIVE_AUCTION',
      );
    });

    it('should revert when anyone tries to resolve auction with no bids', async () => {
      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();

      // advance time to finish auction phase
      await time.increase(String(time.duration.days('3')));

      await expectRevert(
        this.publicMarketplace.resolveAuction(currentAuctionId),
        'Market: CANNOT_RESOLVE_AUCTION_WITH_NO_BIDS',
      );
    });
  });

  describe('getAuctionWinningBid()', () => {
    let currentPrivateSaleId;
    let currentAuctionId;
    let currentBidId;
    let currentNftId;
    let bid;
    before('get auction winning bid', async () => {
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();

      // place bid for user2
      await this.publicMarketplace.placeBid(currentAuctionId, ether('2'), { from: user2 });

      currentBidId = await this.publicMarketplace.getCurrentBidId();

      // get winning bid
      bid = await this.publicMarketplace.getAuctionWinningBid(currentAuctionId);
    });

    it('should get winning bid id correctly', async () => {
      expect(bid.bidderAddress).to.be.eq(user2);
      expect(bid.bidAmount).to.bignumber.be.eq(ether('2'));
      expect(bid.auctionId).to.bignumber.be.eq(currentAuctionId);

      const auction = await this.publicMarketplace.auction(currentAuctionId);

      expect(auction.winningBidId).to.bignumber.be.eq(currentBidId);
    });

    it('should revert when anyone tries to get winning bid with invalid auction id', async () => {
      await expectRevert(this.publicMarketplace.getAuctionWinningBid(18), 'Market: INVALID_AUCTION_ID');
    });
  });

  describe('getters', () => {
    let currentPrivateSaleId;
    let currentNftId;
    let currentAuctionId;
    let currentAuctionIdBefore;

    before('create auction', async () => {
      currentAuctionIdBefore = await this.publicMarketplace.getCurrentAuctionId();
      // create the NFT and list for sale
      await this.privateMarketplace.createAndSellNFT(ether('1'), this.sampleToken.address, url, 10, {
        from: minter,
      });

      currentNftId = await this.ERC1155NFT.getCurrentNftId();
      currentPrivateSaleId = await this.privateMarketplace.getCurrentSaleId();

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user1 });

      // create auction
      await this.publicMarketplace.createNFTAuction(
        currentNftId,
        ether('1'),
        this.sampleToken.address,
        String(time.duration.days('2')),
        {
          from: user1,
        },
      );

      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();
    });

    it('should get current auction id correctly', async () => {
      currentAuctionId = await this.publicMarketplace.getCurrentAuctionId();
      expect(currentAuctionId).to.bignumber.be.gt(currentAuctionIdBefore);
    });

    it('should get current bid id correctly', async () => {
      // get current bidId
      const currentBidId = await this.publicMarketplace.getCurrentBidId();

      // place bid
      await this.publicMarketplace.placeBid(currentAuctionId, ether('2'), { from: user2 });

      // get current bidId
      const bidId = await this.publicMarketplace.getCurrentBidId();

      expect(bidId).to.bignumber.be.gt(currentBidId);
    });

    it('should get current sale id correctly', async () => {
      const currentSaleIdBefore = await this.publicMarketplace.getCurrentSaleId();

      await this.sampleToken.approve(this.privateMarketplace.address, MAX_UINT256, { from: user2 });

      // buy nft from sale
      await this.privateMarketplace.buyNFT(currentPrivateSaleId, { from: user2 });

      // approve nft to PublicMarketplace contract
      await this.ERC1155NFT.setApprovalForAll(this.publicMarketplace.address, true, { from: user2 });

      // create sale for the nft
      await this.publicMarketplace.sellNFT(currentNftId, ether('2'), this.sampleToken.address, {
        from: user2,
      });

      const currentSaleIdAfter = await this.publicMarketplace.getCurrentSaleId();
      expect(currentSaleIdAfter).to.bignumber.be.gt(currentSaleIdBefore);
    });

    it('should return isActiveSale correctly', async () => {
      const currentSaleId = await this.publicMarketplace.getCurrentSaleId();

      let isActive = await this.publicMarketplace.isActiveSale(currentSaleId);

      expect(isActive).to.be.eq(true);

      // cancel sale
      await this.publicMarketplace.cancelSaleAndClaimToken(currentSaleId, { from: user2 });

      isActive = await this.publicMarketplace.isActiveSale(currentSaleId);
      expect(isActive).to.be.eq(false);
    });

    it('should revert when anyone gets the sale status with invalid sale id', async () => {
      await expectRevert(this.publicMarketplace.isActiveSale('15'), 'Market: INVALID_SALE_ID');
    });

    it('should return isSupported token correctly', async () => {
      let isSupported = await this.publicMarketplace.isSupportedToken(this.sampleToken.address);
      expect(isSupported[0]).to.be.eq(true);

      await this.publicMarketplace.removeSupportedToken(this.sampleToken.address, { from: owner });

      isSupported = await this.publicMarketplace.isSupportedToken(this.sampleToken.address);
      expect(isSupported[0]).to.be.eq(false);
    });
  });
});
