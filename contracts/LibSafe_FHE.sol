pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LibSafeFHE is ZamaEthereumConfig {
    struct LibraryItem {
        string title;
        euint32 encryptedBorrowCount;
        uint256 publicCategory;
        uint256 publicYear;
        string author;
        address creator;
        uint256 timestamp;
        uint32 decryptedBorrowCount;
        bool isVerified;
    }

    mapping(string => LibraryItem) public libraryItems;
    string[] public itemIds;

    event ItemAdded(string indexed itemId, address indexed creator);
    event BorrowCountVerified(string indexed itemId, uint32 decryptedCount);

    constructor() ZamaEthereumConfig() {
    }

    function addItem(
        string calldata itemId,
        string calldata title,
        externalEuint32 encryptedBorrowCount,
        bytes calldata inputProof,
        uint256 publicCategory,
        uint256 publicYear,
        string calldata author
    ) external {
        require(bytes(libraryItems[itemId].title).length == 0, "Item already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedBorrowCount, inputProof)), "Invalid encrypted input");

        libraryItems[itemId] = LibraryItem({
            title: title,
            encryptedBorrowCount: FHE.fromExternal(encryptedBorrowCount, inputProof),
            publicCategory: publicCategory,
            publicYear: publicYear,
            author: author,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedBorrowCount: 0,
            isVerified: false
        });

        FHE.allowThis(libraryItems[itemId].encryptedBorrowCount);
        FHE.makePubliclyDecryptable(libraryItems[itemId].encryptedBorrowCount);

        itemIds.push(itemId);
        emit ItemAdded(itemId, msg.sender);
    }

    function verifyBorrowCount(
        string calldata itemId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(libraryItems[itemId].title).length > 0, "Item does not exist");
        require(!libraryItems[itemId].isVerified, "Data already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(libraryItems[itemId].encryptedBorrowCount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        libraryItems[itemId].decryptedBorrowCount = decodedValue;
        libraryItems[itemId].isVerified = true;

        emit BorrowCountVerified(itemId, decodedValue);
    }

    function getEncryptedBorrowCount(string calldata itemId) external view returns (euint32) {
        require(bytes(libraryItems[itemId].title).length > 0, "Item does not exist");
        return libraryItems[itemId].encryptedBorrowCount;
    }

    function getLibraryItem(string calldata itemId) external view returns (
        string memory title,
        uint256 publicCategory,
        uint256 publicYear,
        string memory author,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedBorrowCount
    ) {
        require(bytes(libraryItems[itemId].title).length > 0, "Item does not exist");
        LibraryItem storage item = libraryItems[itemId];

        return (
            item.title,
            item.publicCategory,
            item.publicYear,
            item.author,
            item.creator,
            item.timestamp,
            item.isVerified,
            item.decryptedBorrowCount
        );
    }

    function getAllItemIds() external view returns (string[] memory) {
        return itemIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

