'use client';
import React, { useState } from 'react';
import { useQueueContext } from '../queue-control/queue-context';
import { BoardDetails, Climb } from '@/app/lib/types';
import { PlusCircleOutlined, HeartOutlined, InfoCircleOutlined, CheckCircleOutlined, ArrowUpOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { constructClimbViewUrl, constructClimbViewUrlWithSlugs } from '@/app/lib/url-utils';
import { track } from '@vercel/analytics';
import { message } from 'antd';
import { Tooltip, Button } from 'antd';
import {
  getBluetoothPacket,
  getCharacteristic,
  requestDevice,
  splitMessages,
  writeCharacteristicSeries,
} from '../board-bluetooth-control/bluetooth';
import { HoldRenderData } from '../board-renderer/types';

// import TickClimbButton from '@/c/tick-climb/tick-climb-button';

type ClimbCardActionsProps = {
  climb?: Climb;
  boardDetails: BoardDetails;
};
const ClimbCardActions = ({ climb, boardDetails }: ClimbCardActionsProps) => {
  const { addToQueue, queue } = useQueueContext();
  const [isDuplicate, setDuplicateTimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const bluetoothDeviceRef = React.useRef<BluetoothDevice | null>(null);
  const characteristicRef = React.useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  if (!climb) {
    return [];
  }

  const isAlreadyInQueue = queue.some((item) => item.climb.uuid === climb.uuid);

  const handleAddToQueue = () => {
    if (addToQueue && !isDuplicate) {
      addToQueue(climb);

      const climbName = climb.name || '';
      message.info(`Successfully added ${climbName} to the queue`);

      track('Add to Queue', {
        boardLayout: boardDetails.layout_name || '',
        queueLength: queue.length + 1,
      });

      setDuplicateTimer(true);

      setTimeout(() => {
        setDuplicateTimer(false);
      }, 3000);
    }
  };

  // Direct send to board logic
  const handleSendToBoard = async () => {
    if (!navigator.bluetooth) {
      return message.error('Current browser does not support Web Bluetooth.');
    }
    setLoading(true);
    try {
      if (!bluetoothDeviceRef.current || !characteristicRef.current) {
        const bluetoothboardname = boardDetails.board_name[0].toUpperCase() + boardDetails.board_name.slice(1);
        const device = await requestDevice(bluetoothboardname);
        const characteristic = await getCharacteristic(device);
        if (characteristic) {
          bluetoothDeviceRef.current = device;
          characteristicRef.current = characteristic;
        }
      }
      // Prepare frames (handle mirrored)
      let frames = climb.frames;
      if (climb.mirrored && boardDetails.holdsData) {
        // Use the mirrored frames logic from send-climb-to-board-button
        const holdIdToMirroredIdMap = new Map<number, number>();
        (boardDetails.holdsData as HoldRenderData[]).forEach((hold) => {
          if (hold.mirroredHoldId) {
            holdIdToMirroredIdMap.set(hold.id, hold.mirroredHoldId);
          }
        });
        frames = frames
          .split('p')
          .filter((hold) => hold)
          .map((holdData) => {
            const [holdId, stateCode] = holdData.split('r').map((str) => Number(str));
            const mirroredHoldId = holdIdToMirroredIdMap.get(holdId);
            if (mirroredHoldId === undefined) {
              throw new Error(`Mirrored hold ID is not defined for hold ID ${holdId}.`);
            }
            return `p${mirroredHoldId}r${stateCode}`;
          })
          .join('');
      }
      const placementPositions = boardDetails.ledPlacements;
      const bluetoothPacket = getBluetoothPacket(frames, placementPositions, boardDetails.board_name);
      if (characteristicRef.current) {
        await writeCharacteristicSeries(characteristicRef.current, splitMessages(bluetoothPacket));
        track('Climb Sent to Board Direct', {
          climbUuid: climb.uuid,
          boardLayout: `${boardDetails.layout_name}`,
        });
        message.success('Climb sent to board!');
      }
    } catch (error) {
      console.error('Error sending climb to board:', error);
      message.error('Failed to send climb to board.');
    } finally {
      setLoading(false);
    }
  };

  return [
    <Tooltip key="sendtoboard" title="Send to board">
      <Button
        icon={<ArrowUpOutlined />}
        loading={loading}
        onClick={handleSendToBoard}
        type="default"
        size="small"
        style={{ color: '#1890ff' }}
        aria-label="Send climb to board"
      />
    </Tooltip>,
    // <SettingOutlined key="setting" />,
    // <TickClimbButton key="tickclimbbutton" />,
    <Link
      key="infocircle"
      href={
        boardDetails.layout_name && boardDetails.size_name && boardDetails.set_names
          ? constructClimbViewUrlWithSlugs(
              boardDetails.board_name,
              boardDetails.layout_name,
              boardDetails.size_name,
              boardDetails.set_names,
              climb.angle,
              climb.uuid,
              climb.name,
            )
          : constructClimbViewUrl(
              {
                board_name: boardDetails.board_name,
                layout_id: boardDetails.layout_id,
                size_id: boardDetails.size_id,
                set_ids: boardDetails.set_ids,
                angle: climb.angle,
              },
              climb.uuid,
              climb.name,
            )
      }
      onClick={() => {
        track('Climb Info Viewed', {
          boardLayout: boardDetails.layout_name || '',
        });
      }}
    >
      <InfoCircleOutlined />
    </Link>,
    <HeartOutlined key="heart" onClick={() => message.info('TODO: Implement')} />,
    isAlreadyInQueue ? (
      <CheckCircleOutlined
        key="edit"
        onClick={handleAddToQueue}
        style={{ color: '#52c41a', cursor: isDuplicate ? 'not-allowed' : 'pointer' }}
      />
    ) : (
      <PlusCircleOutlined
        key="edit"
        onClick={handleAddToQueue}
        style={{ color: 'inherit', cursor: isDuplicate ? 'not-allowed' : 'pointer' }}
      />
    ),
  ];
};

export default ClimbCardActions;
