// A stand-in for the Leaflet map in the tests of the list and the map panel. It shows its props
// as text and has buttons that call its callbacks.
import type { ParkMapProps } from '../../../web/components/park-map';

/**
 * Renders the props of the map as text, with buttons for the callbacks.
 *
 * @param props - The map props.
 * @returns The stand-in.
 */
export function ParkMapStub(props: ParkMapProps): React.JSX.Element {
  const {
    parks,
    selection,
    viewRequest,
    onSelect,
    onTileErrorChange,
    onOutsideChange,
    onViewLeave,
  } = props;
  return (
    <div data-testid="map">
      <p>Map markers: {parks.length}</p>
      <p>Map view: {viewRequest.view}</p>
      <p>
        Map selection:{' '}
        {selection === undefined ? 'none' : `${selection.id} from ${selection.source}`}
      </p>
      <button
        type="button"
        onClick={() => {
          onSelect('zion', 'map');
        }}
      >
        Click the Zion marker
      </button>
      <button
        type="button"
        onClick={() => {
          onTileErrorChange(true);
        }}
      >
        Fail the tiles
      </button>
      <button
        type="button"
        onClick={() => {
          onTileErrorChange(false);
        }}
      >
        Load the tiles again
      </button>
      <button type="button" onClick={onViewLeave}>
        Drag the map
      </button>
      <button
        type="button"
        onClick={() => {
          onOutsideChange({
            total: 9,
            byRegion: {
              lower48: 0,
              alaska: 8,
              hawaii: 0,
              'american-samoa': 1,
              'virgin-islands': 0,
            },
          });
        }}
      >
        Move the map
      </button>
      <button
        type="button"
        onClick={() => {
          onOutsideChange({
            total: 1,
            byRegion: {
              lower48: 0,
              alaska: 0,
              hawaii: 1,
              'american-samoa': 0,
              'virgin-islands': 0,
            },
          });
        }}
      >
        Move the map to show all but one
      </button>
    </div>
  );
}
