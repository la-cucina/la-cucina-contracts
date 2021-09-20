// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './INFT.sol';

interface IIngredientNFT is INFT {
	struct BaseIngredient {
		uint256 id;
		string name;
		string svg;
	}

	struct Ingredient {
		uint256 id;
		string name;
		uint256 fat;
		uint256 baseIngredientId;
		string svg;
	}

	function mint(
		address _account,
		uint256 _nftId,
		uint256 _amountOfCopies
	) external;

	function burn(
		address _account,
		uint256 _nftId,
		uint256 _amountOfCopies
	) external;

	function ingredients(uint256 _ingredientId)
		external
		view
		returns (
			uint256 id,
			string memory name,
			uint256 fat,
			uint256 totalVariations
		);

	function baseIngredients(uint256 _baseIngredientId)
		external
		view
		returns (
			uint256 id,
			string memory name,
			string[] memory svgs
		);

	function defs(uint256 defId) external view returns (string memory);

	function getCurrentBaseIngredientId() external view returns (uint256);

	function getCurrentDefs() external view returns (uint256);

	function ingredientVariation(uint256 ingredinetId, uint256 variationIndex)
		external
		view
		returns (uint256);
}
