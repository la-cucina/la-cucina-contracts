// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '../BaseERC721.sol';
import '../interfaces/IERC2981.sol';

/**
 * @dev {ERC721} token, including:
 *
 *  - ability for holders to burn (destroy) their tokens
 *  - a minter role that allows for token minting (creation)
 *  - a pauser role that allows to stop all token transfers
 *  - token ID and URI autogeneration
 *
 * This contract uses {AccessControl} to lock permissioned functions using the
 * different roles - head to its documentation for details.
 *
 * The account that deploys the contract will be granted the minter and pauser
 * roles, as well as the default admin role, which will let it grant both minter
 * and pauser roles to other accounts.
 */
contract BaseERC721WithRoyalties is BaseERC721 {
	/*
	=======================================================================
	==================== Public Variables / Constants =====================
	=======================================================================
	*/
	/// @notice max royalty fee
	uint8 public constant MAX_ROYALTY_FEE = 250; //25%
	/// @notice royalty receiver address
	address public royaltyReceiver;
	/// @notice royalty fee percentage
	uint8 public royaltyFee;

	function initialize_BaseERC721WithRoyalties(
		string memory _name,
		string memory _symbol,
		string memory baseTokenURI,
		address _royaltyReceiver,
		uint8 _royaltyFee
	) internal virtual initializer {
		require(_royaltyReceiver != address(0), 'Royalty: INVALID_RECEIVER');
		require(_royaltyFee <= MAX_ROYALTY_FEE, 'Royalty: INVALID_FEE');
		__BaseERC721WithRoyalties_init(_name, _symbol, baseTokenURI, _royaltyReceiver, _royaltyFee);
	}

	/**
	 * @dev Grants `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` and `PAUSER_ROLE` to the
	 * account that deploys the contract.
	 *
	 * Token URIs will be autogenerated based on `baseURI` and their token IDs.
	 * See {ERC721-tokenURI}.
	 */
	function __BaseERC721WithRoyalties_init(
		string memory _name,
		string memory _symbol,
		string memory _baseTokenURI,
		address _royaltyReceiver,
		uint8 _royaltyFee
	) internal initializer {
		__BaseERC721_init(_name, _symbol, _baseTokenURI);
		__BaseERC721WithRoyalties_init_unchained(_royaltyReceiver, _royaltyFee);
	}

	function __BaseERC721WithRoyalties_init_unchained(address _royaltyReceiver, uint8 _royaltyFee)
		internal
		initializer
	{
		royaltyReceiver = _royaltyReceiver;
		royaltyFee = _royaltyFee;
	}

	/**
	 * @notice This method allows admin to update the royalty receiver address
	 * @param _newReceiver - indicates the new royalty receiver address
	 */
	function updateRoyaltyReceiver(address _newReceiver) external virtual onlyAdmin {
		require(_newReceiver != address(0), 'Royalty: INVALID_RECEIVER');
		royaltyReceiver = _newReceiver;
	}

	/**
	 * @notice This method allows admin to update the royalty fee
	 * @param _newFee - indicates the new royalty fee
	 */
	function updateRoyaltyFee(uint8 _newFee) external virtual onlyAdmin {
		require(_newFee <= MAX_ROYALTY_FEE, 'Royalty: INVALID_FEE');
		royaltyFee = _newFee;
	}

	/*
   	=======================================================================
   	======================== Getter Methods ===============================
   	=======================================================================
 	*/
	function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
		return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId);
	}

	/**
	 * @dev Called with the sale price to determine how much royalty is owed and to whom.
	 * @param  - the NFT asset queried for royalty information
	 * @param _salePrice - the sale price of the NFT asset specified by `tokenId`
	 * @return receiver - address of who should be sent the royalty payment
	 * @return royaltyAmount - the royalty payment amount for `salePrice`
	 */
	function royaltyInfo(uint256, uint256 _salePrice)
		external
		view
		virtual
		returns (address, uint256)
	{
		uint256 royaltyAmount;
		royaltyAmount = (_salePrice * royaltyFee) / 1000;
		return (royaltyReceiver, royaltyAmount);
	}
}
